/**
 * General utility functions
 */
import {NormalDistribution, NormalMixture, StudentTDistribution} from "../types";
import normal from "@stdlib/stats/base/dists/normal";
import {sqrt} from "mathjs";
import {T} from "@stdlib/stats-base-dists-t";
// @ts-ignore
import FFT from 'fft.js';
import hash from "object-hash";

const distHashTable = new Map<string, number>
const distHashList: string[] = []

/**
 * Get the entry of a distance matrix
 */
export function getMatrixEntry(distanceMatrix: Map<string, Map<string, number>>, sourceNodeId: string, targetNodeId: string): number {
    if (sourceNodeId === targetNodeId) {
        return 0;
    }
    const distances = distanceMatrix.get(sourceNodeId);
    if (distances === undefined) {
        throw new Error(`Source node ${sourceNodeId} not found in distance matrix`);
    }
    const distance = distances.get(targetNodeId);
    if (distance === undefined) {
        throw new Error(`Target node ${targetNodeId} not found in distance matrix of source node ${sourceNodeId}`);
    }
    return distance
}

/**
 * Compute the probability that the pollution level does not exceed a given threshold, using the convolution of the probability density functions of the provided distributions.
 */
export function convProb(distributions: NormalDistribution[], pollutionThreshold: number): number {
    if (distributions.length === 0) {
        throw new Error('No distributions provided')
    }
    const convolution1 = distributions
        .map((dist) => ({
            mu: dist.mu,
            var: dist.sigma ** 2
        }))
        .reduce((a, b) => ({
            mu: a.mu + b.mu,
            var: a.var + b.var
        }))
    const res =  normal.cdf(pollutionThreshold*distributions.length, convolution1.mu, <number>sqrt(convolution1.var))
    return res
}

/**
 * Compute the probability that the pollution level exceeds a given threshold, using the convolution of the probability density functions of the provided distributions.
 */
export function convProbFFT(distributions: (StudentTDistribution | NormalMixture)[], pollutionThreshold: number): number {
    const disthash: string = hash({
        d: distributions,
        t: pollutionThreshold
    })
    if (distHashTable.has(disthash)) {
        return distHashTable.get(disthash) as number
    }
    const sampleSize = 2**17
    const maxX = distributions.length;

    const sample = Array.from({ length: sampleSize }, (_, i) => (i * maxX) / (sampleSize - 1));
    const pickUpPDFs = sampleDistributions(distributions, sample);

    if (pickUpPDFs.length === 0) {
        throw new Error('No distributions provided')
    }
    let g = pickUpPDFs[0];
    if (pickUpPDFs.length >= 1) {
        g = fftConvolution(pickUpPDFs, maxX);
    }

    const area = computeArea(g, maxX, pollutionThreshold);
    console.log("area: " + area);
    distHashTable.set(disthash, area)
    distHashList.push(disthash)
    console.log(`distHashTable size: ${distHashTable.size}`)
    if (distHashList.length > 100) {
        let x = distHashList.shift()
        x && distHashTable.delete(x)
    }
    return area;
}

/**
 * Evaluate the probability density functions of a list of distributions at a given array of sample points.
 */
function sampleDistributions(distributions: (StudentTDistribution | NormalMixture)[], sample: number[]) {
    return distributions.map(distribution => sample.map(x =>
    {
        if (distribution.hasOwnProperty('n')) {
            distribution = distribution as StudentTDistribution;
            const t_dist = new T(distribution.n-1);
            const x_normalized = (x - distribution.mu) / distribution.sigma;
            return t_dist.pdf(x_normalized)
        } else {
            distribution = distribution as NormalMixture;
            return (distribution.weights[0] * normal.pdf(x, distribution.mu1, distribution.sigma1) +
                distribution.weights[1] * normal.pdf(x, distribution.mu2, distribution.sigma2) +
                (1-distribution.weights[0]-distribution.weights[1]) * normal.pdf(x, distribution.mu3, distribution.sigma3));
        }
    }));
}

/**
 * Perform convolution of a list of probability density functions using the Fast Fourier Transform,
 * and return the cumulative distribution function evaluated at the given threshold.
 */
function fftConvolution(pdfs: number[][], xlim: number): number[] {
    const fftInstance = new FFT(pdfs[0].length);
    const ffts = pdfs.map(pdf => fftInstance.createComplexArray());
    // Compute FFTs
    pdfs.forEach((pdf, index) => {
        fftInstance.realTransform(ffts[index], pdf);
    });
    // Multiply FFT results
    const product = ffts.reduce((acc, curr) => {
        for (let i = 0; i < acc.length; i++) {
            acc[i] *= curr[i];
        }
        return acc;
    });

    // Inverse FFT
    const conv = fftInstance.createComplexArray();
    fftInstance.inverseTransform(conv, product);

    // Compute area and normalize
    const convReal = Array.from(conv).filter((_, index) => index % 2 === 0); // Extract real parts
    const area = computeArea(<number[]>convReal, xlim);
    return (<number[]>convReal).map(value => value / area);
}


/**
 * Compute the normalized area under the curve of a probability density function.
 * @param pdf
 * @param xlim
 * @param threshold
 */
function computeArea(pdf: number[], xlim: number, threshold: number = 0): number {
    const len = pdf.length;
    const thresholdIndex = Math.round((threshold / xlim) * len);
    const slicedPdf = pdf.slice(thresholdIndex);
    const integral = trapz(slicedPdf, xlim);
    return integral;
}

/**
 * Approximate the integral of a function using the trapezoidal rule.
 * @param y
 * @param dx
 */
function trapz(y: number[], dx: number): number {
    let integral = 0;
    for (let i = 0; i < y.length - 1; i++) {
        integral += (y[i] + y[i + 1]) * dx / 2;
    }
    return integral;
}

