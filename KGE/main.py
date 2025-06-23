import os
import time

import pandas as pd
import torch
from dotenv import load_dotenv
from neo4j import GraphDatabase
from pykeen.hpo import hpo_pipeline
from pykeen.pipeline import pipeline
from pykeen.predict import predict_target
from pykeen.triples import TriplesFactory

load_dotenv()

USER = "neo4j"
URI = os.getenv("KG_URI")
PASSWORD = os.getenv("KG_PASSWORD")
AUTH = (USER, PASSWORD)


def get_triples(tx):
    result = tx.run(
        """
        MATCH (s:Report)-[r:status]->(status:Status)
        RETURN toString(id(s)) as source, toString(id(status)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2,3,4]
        CALL {
            WITH s
            MATCH (s)-[r:tag]->(t:TrashType)
            return r, t
        }
        RETURN distinct toString(id(s)) as source, toString(id(t)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        RETURN toString(id(status)) as source, toString(status.timestamp.year) AS target, "status_year" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        RETURN toString(id(status)) as source, toString(status.timestamp.month) AS target, "status_month" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        RETURN toString(id(status)) as source, toString(status.timestamp.day) AS target, "status_day" as type
        UNION
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        CALL {
            WITH p2
            MATCH (p2)-[r3:location]->(l:Location)
            return toString(id(p2)) as source, toString(id(l)) AS target, type(r3) as type
        }
        RETURN source, target, type
        UNION 
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        RETURN toString(id(p2)) as source, toString(id(p)) AS target, type(r2) as type 
        UNION 
        MATCH (p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        RETURN toString(id(p)) as source, toString(id(s)) AS target, type(r1) as type
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def get_training_triples(tx):
    result = tx.run(
        """
        MATCH (s:Report)-[r:status]->(status:Status)
        RETURN toString(id(s)) as source, toString(id(status)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        CALL {
            WITH s
            MATCH (s)-[r:tag]->(t:TrashType)
            where not (t.label = "math_count") and not (t.label = "image_noise")
            return r,t
        }
        RETURN distinct toString(id(s)) as source, toString(id(t)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        RETURN toString(id(status)) as source, toString(status.timestamp.year) AS target, "status_year" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        RETURN toString(id(status)) as source, toString(status.timestamp.month) AS target, "status_month" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        RETURN toString(id(status)) as source, toString(status.timestamp.day) AS target, "status_day" as type
        UNION
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        CALL {
            WITH p2
            MATCH (p2)-[r3:location]->(l:Location)
            return toString(id(p2)) as source, toString(id(l)) AS target, type(r3) as type
        }
        RETURN source, target, type
        UNION 
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        RETURN toString(id(p2)) as source, toString(id(p)) AS target, type(r2) as type 
        UNION 
        MATCH (p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [1,2]
        RETURN toString(id(p)) as source, toString(id(s)) AS target, type(r1) as type
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def get_test_triples(tx):
    result = tx.run(
        """
        MATCH (s:Report)-[r:status]->(status:Status)
        RETURN toString(id(s)) as source, toString(id(status)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        CALL {
            WITH s
            MATCH (s)-[r:tag]->(t:TrashType)
            where not (t.label = "math_count") and not (t.label = "image_noise")
            return r,t
        }
        RETURN distinct toString(id(s)) as source, toString(id(t)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        RETURN toString(id(status)) as source, toString(status.timestamp.year) AS target, "status_year" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        RETURN toString(id(status)) as source, toString(status.timestamp.month) AS target, "status_month" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        RETURN toString(id(status)) as source, toString(status.timestamp.day) AS target, "status_day" as type
        UNION
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        CALL {
            WITH p2
            MATCH (p2)-[r3:location]->(l:Location)
            return toString(id(p2)) as source, toString(id(l)) AS target, type(r3) as type
        }
        RETURN source, target, type
        UNION 
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        RETURN toString(id(p2)) as source, toString(id(p)) AS target, type(r2) as type 
        UNION 
        MATCH (p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [3]
        RETURN toString(id(p)) as source, toString(id(s)) AS target, type(r1) as type
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def get_validation_triples(tx):
    result = tx.run(
        """
        MATCH (s:Report)-[r:status]->(status:Status)
        RETURN toString(id(s)) as source, toString(id(status)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        CALL {
            WITH s
            MATCH (s)-[r:tag]->(t:TrashType)
            where not (t.label = "math_count") and not (t.label = "image_noise")
            return r,t
        }
        RETURN distinct toString(id(s)) as source, toString(id(t)) AS target, type(r) as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        RETURN toString(id(status)) as source, toString(status.timestamp.year) AS target, "status_year" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        RETURN toString(id(status)) as source, toString(status.timestamp.month) AS target, "status_month" as type
        UNION
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        RETURN toString(id(status)) as source, toString(status.timestamp.day) AS target, "status_day" as type
        UNION
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        CALL {
            WITH p2
            MATCH (p2)-[r3:location]->(l:Location)
            return toString(id(p2)) as source, toString(id(l)) AS target, type(r3) as type
        }
        RETURN source, target, type
        UNION 
        MATCH (p2:PickUp:LAYER_2)-[r2:contains]->(p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        RETURN toString(id(p2)) as source, toString(id(p)) AS target, type(r2) as type 
        UNION 
        MATCH (p:PickUp:LAYER_1)-[r1:report]->(s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [4]
        RETURN toString(id(p)) as source, toString(id(s)) AS target, type(r1) as type
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def prediction_query(tx):
    result = tx.run(
        """
        MATCH (s:Report)-[:status]->(status:Status)
        WHERE status.timestamp.month IN [5,6]
        RETURN toString(id(s)) as id
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def remove_old_tags(tx, tag):
    tx.run(
        f"""
        MATCH (s:Report)-[x:{tag}]->(t:TrashType)
        DELETE x
        """)


def get_parents_query(tx):
    result = tx.run(
        """
        MATCH (t:TrashType)
        RETURN toString(id(t)) as id
        """)
    return pd.DataFrame([r.values() for r in result], columns=result.keys())


def store_candidates(tx, pickup_id, report_ids, tag_name):
    print(f"pickup id: {pickup_id}")
    print(f"report ids: {report_ids}")
    tx.run(f"""
        MATCH (n)
        WHERE id(n) = toInteger($pickup_id)
        UNWIND $candidates as ca
        MATCH (c)
        WHERE id(c) = toInteger(ca)
        MERGE (n)-[:{tag_name}]->(c)
        """, {'pickup_id': pickup_id, 'candidates': report_ids, 'tag_name': tag_name})


print(f"Trying to connect to KG at {URI}")


def predict_tags(model_path: str, tag_name: str):
    output = torch.load(model_path)
    print("model successfully loaded")
    session_compound = session.execute_read(prediction_query)['id']
    print("prediction query done")
    parents = session.execute_read(get_parents_query)['id']
    session.execute_write(remove_old_tags, tag_name)
    all_scores = []
    for i in range(len(session_compound)):
        df = predict_target(
            model=output,
            head=session_compound[i],
            relation='tag',
            triples_factory=tf,
            targets=parents).df
        print(str(i) + "/" + str(len(session_compound)))
        all_scores.extend([(session_compound[i], df['tail_label'][j], df['score'][j]) for j in range(len(df))])
    all_scores = sorted(all_scores, key=lambda x: x[2], reverse=True)
    # 4.07% of the possible options are actually tagged (in the training data), adjusted for multi-tags (multiple edges to same trash type)
    all_scores = all_scores[:round(len(all_scores) * 407 / 10000)]
    for score in all_scores:
        print(f"predict tag: head: {score[0]} tail: {score[1]} with score: {score[2]}")
        session.execute_write(store_candidates, score[0], [score[1]], tag_name)


def hpo_pairre(training, testing, validation):
    hpo_pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='PairRE',
        n_trials=1000,
        stopper='early',
        stopper_kwargs=dict(frequency=10, patience=2, relative_delta=0.01),
        # epochs=1,
        # dimensions=512,
        model_kwargs=dict(random_seed=1000),
    )


def hpo_transe(training, testing, validation):
    hpo_pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='TransE',
        n_trials=1000,
        stopper='early',
        stopper_kwargs=dict(frequency=10, patience=2, relative_delta=0.01),
        model_kwargs=dict(random_seed=1000),
    )


def hpo_tucker(training, testing, validation):
    hpo_pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='TuckER',
        n_trials=4000,
        stopper='early',
        stopper_kwargs=dict(frequency=10, patience=2, relative_delta=0.01),
        training_kwargs_ranges=dict(
            batch_size=dict(type=int, low=16, high=1024, log=True),
        ),
        negative_sampler_kwargs_ranges=dict(
            num_negs_per_pos=dict(type=int, low=1, high=19, log=True),
        ),
        model_kwargs=dict(random_seed=1000),
    )


def training_transe(training, testing, validation):
    return pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='TransE',
        model_kwargs=dict(embedding_dim=80, scoring_fct_norm=1),
        loss_kwargs=dict(margin=2.814806827125555),
        optimizer_kwargs=dict(lr=0.008058540259651512),
        negative_sampler_kwargs=dict(num_negs_per_pos=86),
        training_kwargs=dict(num_epochs=100, batch_size=4096),
    )


def training_pairre(training, testing, validation):
    return pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='PairRE',
        model_kwargs=dict(embedding_dim=256, p=1),
        loss='NSSA',
        loss_kwargs=dict(margin=9, adversarial_temperature=0.9704281434),
        optimizer_kwargs=dict(lr=0.06565888227),
        negative_sampler_kwargs=dict(num_negs_per_pos=29),
        training_kwargs=dict(num_epochs=400, batch_size=2048),
    )


def training_tucker():
    return pipeline(
        training=training,
        testing=testing,
        validation=validation,
        model='TuckER',
        model_kwargs=dict(embedding_dim=224, relation_dim=16, dropout_0=0.2, dropout_1=0.0, dropout_2=0.1),
        optimizer_kwargs=dict(lr=0.0012459322629918364),
        negative_sampler_kwargs=dict(num_negs_per_pos=12),
        training_kwargs=dict(num_epochs=500, batch_size=219),
    )


if __name__ == "__main__":
    """
    This script is used to train a model on the KG and predict tags for the reports.
    Change the COMMAND variable to one of the following:
    - hpo-transe: to run hyperparameter optimization for TransE
    - hpo-pairre: to run hyperparameter optimization for PairRE
    - hpo-tucker: to run hyperparameter optimization for TuckER
    - predict-transe: to predict tags using the TransE model
    - predict-pairre: to predict tags using the PairRE model
    - predict-tucker: to predict tags using the TuckER model
    """
    COMMAND = "hpo-transe"

    with GraphDatabase.driver(URI, auth=AUTH) as driver:
        driver.verify_connectivity()

        print("Connection successful")
        session = driver.session()

        triples = session.execute_read(get_triples)
        print("fetched triples")
        training_triples = session.execute_read(get_training_triples)
        test_triples = session.execute_read(get_test_triples)
        validation_triples = session.execute_read(get_validation_triples)
        tf = TriplesFactory.from_labeled_triples(
            triples[["source", "type", "target"]].values
        )
        # get spo triples from the graph
        print("get spo triples from graph")

        training = TriplesFactory.from_labeled_triples(
            training_triples[["source", "type", "target"]].values,
            entity_to_id=tf.entity_to_id,
            relation_to_id=tf.relation_to_id
        )
        testing = TriplesFactory.from_labeled_triples(
            test_triples[["source", "type", "target"]].values,
            entity_to_id=tf.entity_to_id,
            relation_to_id=tf.relation_to_id
        )
        validation = TriplesFactory.from_labeled_triples(
            validation_triples[["source", "type", "target"]].values,
            entity_to_id=tf.entity_to_id,
            relation_to_id=tf.relation_to_id
        )


        if COMMAND == "hpo-transe":
            hpo_transe(training, testing, validation)
        elif COMMAND == "hpo-pairre":
            hpo_pairre(training, testing, validation)
        elif COMMAND == "hpo-tucker":
            hpo_tucker(training, testing, validation)
        elif COMMAND == "predict-transe":
            training_method = training_transe
            tag_prefix = "PREDICTED_TAGS_TRANSE_"
        elif COMMAND == "predict-pairre":
            training_method = training_pairre
            tag_prefix = "PREDICTED_TAGS_PAIRRE_"
        elif COMMAND == "predict-tucker":
            training_method = training_tucker
            tag_prefix = "PREDICTED_TAGS_TUCKER_"

        if COMMAND.startswith("predict-"):
            for tag_postfix in range(10):
                ts = time.time()
                tag_name = tag_prefix + str(tag_postfix)
                output = training_method(training, testing, validation)
                output.save_to_directory(f'result_{tag_name}')
                print(f"loading model from result_{tag_name}/trained_model.pkl")
                predict_tags(f"result_{tag_name}/trained_model.pkl", tag_name)
                print(f"Time for tag {tag_postfix}: {time.time() - ts}")
