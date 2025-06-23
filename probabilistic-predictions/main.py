import os

import numpy as np
import pyro
import pyro.distributions as dist
import torch
from dotenv import load_dotenv
from neo4j import GraphDatabase
from pyro.infer import NUTS, MCMC
from scipy.stats import t, norm

load_dotenv()

USER = "neo4j"
URI = os.getenv("KG_URI")
#URI = "bolt://localhost:7687"
PASSWORD = os.getenv("KG_PASSWORD")
AUTH = (USER, PASSWORD)

# beta_max is the threshold for pollution level on pickup granularity, not to confuse with report granularity
beta_max = 0.103

def get_avg_pickup_event_pollution(tx):
    return tx.run(
        f"""
      match (p2:PickUp:LAYER_2)-[:contains]-(p1:PickUp:LAYER_1)-[:report]->(r:Report)-[:status]->(s:Status)
      where s.timestamp.month in [1,2,3,4]
      call {{
        with r
        match (r)-[i:tag]->(t:TrashType)
        with t, max(i.probability) as maxProb
        return sum(maxProb*t.severity) as reportScore
      }}
      with left(toString(s.timestamp), 10) as date, p2, reportScore
      return p2.id, date, avg(reportScore) as avgtc
    """).data()


def get_pickups(tx):
    return tx.run(f"""
    match (p2:PickUp:LAYER_2)
    return p2.id
    """).data()


def write_property_to_pickup(tx, pickup_id, property_name, value):
    tx.run(f"""
        MATCH (n:PickUp:LAYER_2)
        WHERE n.id = $pickup_id
        SET n.{property_name} = $value
        """, {'pickup_id': pickup_id, 'value': value})


def normal_model(data):
    # Hyperparameters for the pollution level
    mu = pyro.sample("mu", dist.Normal(0.1, 0.1))  # Prior for the initial pollution level
    sigma = pyro.sample("sigma", dist.HalfCauchy(0.2))  # Standard deviation for noise in daily pollution change

    with pyro.plate("data", len(data)):
        pyro.sample("obs", dist.Normal(mu, sigma), obs=data)


def tri_normal_model(data):
    # Mixture weights (prior probabilities for the components)
    weights = pyro.sample("weights", dist.Dirichlet(torch.tensor([0.1, 0.5, 0.4])))

    # Component parameters
    mu1 = pyro.sample("mu1", dist.Normal(0.0, 0.01))  # Mean of component 1
    mu2 = pyro.sample("mu2", dist.Normal(0.095, 0.01))  # Mean of component 2
    mu3 = pyro.sample("mu3", dist.Normal(0.08, 0.02))  # Mean of component 3

    sigma1 = pyro.sample("sigma1", dist.HalfCauchy(0.005))  # Std. dev. of component 1
    sigma2 = pyro.sample("sigma2", dist.HalfCauchy(0.01))  # Std. dev. of component 2
    sigma3 = pyro.sample("sigma3", dist.HalfCauchy(0.03))  # Std. dev. of component 3

    # Stack the parameters for easy indexing
    mus = torch.stack([mu1, mu2, mu3])
    sigmas = torch.stack([sigma1, sigma2, sigma3])

    # Define the mixture distribution
    with pyro.plate("data", len(data)):
        # Sample the component indices for each data point
        component = pyro.sample("component", dist.Categorical(weights))

        # Select the corresponding parameters for each data point
        mu = mus[component]
        sigma = sigmas[component]

        # Sample the observed data from the selected normal distributions
        pyro.sample("obs", dist.Normal(mu, sigma), obs=data)


def predictive_model(posterior_samples, threshold):
    mu_samples = posterior_samples["mu"]
    sigma_samples = posterior_samples["sigma"]
    n_samples = len(mu_samples)
    print(f"samples {n_samples}")
    # Simulate new data points from the posterior predictive distribution
    predictive_dist = dist.Normal(mu_samples, sigma_samples)
    samples = predictive_dist.sample(sample_shape=(n_samples,))

    # Compute the probability of exceeding the threshold
    prob_exceed = (samples <= threshold).float().mean().item()
    return prob_exceed, sum(mu_samples) / len(samples), sum(sigma_samples) / len(samples)


def predictive_model_tri(posterior_samples, threshold):
    m_samples = posterior_samples["weights"]
    mu1_samples = posterior_samples["mu1"]
    mu2_samples = posterior_samples["mu2"]
    mu3_samples = posterior_samples["mu3"]
    sigma1_samples = posterior_samples["sigma1"]
    sigma2_samples = posterior_samples["sigma2"]
    sigma3_samples = posterior_samples["sigma3"]
    n_samples = len(m_samples)
    print(f"samples {n_samples}")

    # Simulate new data points from the posterior predictive distribution
    predictive_dist1 = dist.Normal(mu1_samples, sigma1_samples)
    predictive_dist2 = dist.Normal(mu2_samples, sigma2_samples)
    predictive_dist3 = dist.Normal(mu3_samples, sigma3_samples)
    samples1 = predictive_dist1.sample(sample_shape=(n_samples,))
    samples2 = predictive_dist2.sample(sample_shape=(n_samples,))
    samples3 = predictive_dist3.sample(sample_shape=(n_samples,))
    x = np.random.choice([0, 1, 2], (n_samples, n_samples),
                         p=[np.mean(m_samples[:, 0].numpy()), np.mean(m_samples[:, 1].numpy()),
                            1 - np.mean(m_samples[:, 0].numpy()) - np.mean(m_samples[:, 1].numpy())])
    combined_samples = np.array([[samples1[i][j] if x[i][j] == 0 else samples2[i][j] if x[i][j] == 1 else samples3[i][j]
                                  for j in range(n_samples)] for i in range(n_samples)]).flatten()

    prob_exceed = torch.tensor(combined_samples > threshold).float().mean().item()
    return (prob_exceed,
            sum(mu1_samples) / n_samples,
            sum(sigma1_samples) / n_samples,
            sum(mu2_samples) / n_samples,
            sum(sigma2_samples) / n_samples,
            sum(mu3_samples) / n_samples,
            sum(sigma3_samples) / n_samples,
            np.mean(m_samples[:, 0].numpy()),
            np.mean(m_samples[:, 1].numpy()))


if __name__ == "__main__":
    with GraphDatabase.driver(URI, auth=AUTH) as driver:
        driver.verify_connectivity()
        print("Connection successful")
        session = driver.session()

        avg_pollution_per_pickup_and_day = session.execute_read(get_avg_pickup_event_pollution)
        pickups = session.execute_read(get_pickups)
        print(avg_pollution_per_pickup_and_day[0])

        pickups = list(set([i['p2.id'] for i in pickups]))
        pickup_pollution = [i['avgtc'] for i in avg_pollution_per_pickup_and_day]
        mu_hat = np.mean(pickup_pollution)
        sigma_hat = np.std(pickup_pollution, ddof=1) + 1e-6
        uninformed_probability = len([i for i in pickup_pollution if i <= beta_max]) / len(pickup_pollution)

        for selected in pickups:
            print(f"Progress {pickups.index(selected)}/{len(pickups)}")
            pickup_pollution = [i['avgtc'] for i in avg_pollution_per_pickup_and_day if i['p2.id'] == selected]
            if len(pickup_pollution) <= 2:
                session.execute_write(write_property_to_pickup, selected, "t_prob", {
                    "prob": uninformed_probability,
                    "dist": {"mu": mu_hat, "sigma": sigma_hat, "n": "1"}
                })
                session.execute_write(write_property_to_pickup, selected, "normal_prob", {
                    "prob": uninformed_probability,
                    "dist": {"mu": mu_hat, "sigma": sigma_hat}
                })
                session.execute_write(write_property_to_pickup, selected, "bayesian_prob", {
                    "prob": uninformed_probability,
                    "dist": {"mu": mu_hat, "sigma": sigma_hat}
                })
                session.execute_write(write_property_to_pickup, selected, "bayesian_prob_mixed", uninformed_probability)
                continue
            print(pickup_pollution)
            mu_hat = np.mean(pickup_pollution)
            sigma_hat = np.std(pickup_pollution, ddof=1) + 1e-6
            normal_dist = dist.Normal(mu_hat, sigma_hat)

            n = len(pickup_pollution)
            t_score = (beta_max - mu_hat) / (sigma_hat / np.sqrt(n))
            t_prob = t.cdf(t_score, df=n - 1)
            n_score = (beta_max - mu_hat) / sigma_hat
            n_prob = norm.cdf(n_score)

            data = torch.tensor(pickup_pollution)
            nuts_kernel = NUTS(normal_model)
            mcmc = MCMC(nuts_kernel, num_samples=500, warmup_steps=100)
            mcmc.run(data)

            # Extract posterior samples
            posterior_samples = mcmc.get_samples()
            bayesian_prob, bayesian_mu, bayesian_sigma = predictive_model(posterior_samples, beta_max)

            # write the results
            session.execute_write(write_property_to_pickup, selected, "t_prob", {
                "prob": t_prob,
                "dist": {"mu": mu_hat, "sigma": sigma_hat, "n": n}
            })
            session.execute_write(write_property_to_pickup, selected, "normal_prob", {
                "prob": n_prob,
                "dist": {"mu": mu_hat, "sigma": sigma_hat}
            })

            session.execute_write(write_property_to_pickup, selected, "bayesian_prob", {
                "prob": bayesian_prob,
                "dist": {
                    "mu": bayesian_mu.item(),
                    "sigma": bayesian_sigma.item()
                }
            })

            data = torch.tensor(pickup_pollution)
            nuts_kernel = NUTS(tri_normal_model)
            mcmc = MCMC(nuts_kernel, num_samples=500, warmup_steps=100)
            mcmc.run(data)
            # print(mcmc.summary())
            posterior_samples = mcmc.get_samples()
            bayesian_prob_mixed, b_mu1, b_s1, b_mu2, b_s2, b_mu3, b_s3, b_w1, b_w2 = predictive_model_tri(
                posterior_samples, beta_max)

            session.execute_write(write_property_to_pickup, selected, "bayesian_prob_mixed", {
                "prob": bayesian_prob_mixed,
                "dist": {
                    "mu1": b_mu1.item(),
                    "sigma1": b_s1.item(),
                    "mu2": b_mu2.item(),
                    "sigma2": b_s2.item(),
                    "mu3": b_mu3.item(),
                    "sigma3": b_s3.item(),
                    "weights": [b_w1.item(), b_w2.item()]
                }
            })
