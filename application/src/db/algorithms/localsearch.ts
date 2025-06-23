import {NormalDistribution, NormalMixture, RouteInfo, StudentTDistribution} from "../../types";
import {
    getBase,
    getDistanceMatrix,
    getDropOff,
    getDurationMatrix,
    getNormalDistributionOfPickUps,
    getNormalMixtureOfPickUps,
    getPickUpsByThreshold,
    getRouteByRouteInfo,
    getRouteInfosFromLayer,
    getStudentTDistributionOfPickUps,
    updateRoute
} from "../neo4j-service";
import {Layer} from "../layer";
import {execSync} from 'child_process';
import * as fs from "node:fs";

import hash from "object-hash";
import {convProb, convProbFFT} from "../utils";
import assert from "node:assert";
import {randomUUID} from "crypto";

let ENABLE_SIMULATED_ANNEALING = true
const INITIAL_SA_TEMPERATURE = 1000

let CE_HASHES: string[] = []
let LKH_HASHES: string[] = []

/**
 * LKH neighborhood structure
 * for intra-route optimization
 */
async function linKernighanHelsgaunNeighborhood(algorithmLayer: Layer, sol: Solution, optimizeDuration: boolean, dMatrix: Map<string, Map<string, number>>, d2Matrix: Map<string, Map<string, number>>, strategy: "classification" | "stochastic" = "classification", probabilityName?: string, pollutionThreshold?: number, pollutionDistributions?: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>) {
    for (let key of sol.routeInformation.keys()) {
        const routeInfo = sol.routeInformation.get(key)
        if (routeInfo) {
            console.log(`linKernighanNeighborhood: ${routeInfo.date.toString()}`)
            await linKernighanHelsgaun(algorithmLayer, routeInfo, optimizeDuration, dMatrix, d2Matrix, strategy, probabilityName, pollutionThreshold)
        }
    }
}

/**
 * Write the problem file for the LKH algorithm in the TSPLIB (http://comopt.ifi.uni-heidelberg.de/software/TSPLIB95/tsp95.pdf) format
 * - conversion to a symmetric TSP is done by the LKH software
 * - fixing start (base) and end (drop-off) node is done as follows:
 *   1. Add an edge from the end node to the start node, with 0 cost
 *   2. Add edges from every other node to the start node, with very high cost
 * @param route
 * @param dMatrix
 */
function writeProblemFile(routeId: string, route: string[], dMatrix: Map<string, Map<string, number>>) {
    const fileName = 'lkh-input/' + routeId + '-problem.tsp'
    let content = ""
    content += 'NAME: ' + routeId + '\n'
    content += 'COMMENT: ' + route.join("    ") + '\n'
    content += 'TYPE: ATSP\n'
    content += 'DIMENSION: ' + route.length + '\n'
    content += 'EDGE_WEIGHT_TYPE: EXPLICIT\n'
    content += 'EDGE_WEIGHT_FORMAT: FULL_MATRIX\n'
    content += 'EDGE_WEIGHT_SECTION\n'
    for (let i = 0; i < route.length; i += 1) {
        for (let j = 0; j < route.length; j += 1) {
            if (route[i] == route[j]) {
                content += 10 ** 7 + '\t'
            } else if (j == 0) {
                if (i == route.length - 1) {
                    content += 0 + '\t'
                } else {
                    content += 10 ** 7 + '\t'
                }
            } else content += Math.round(dMatrix.get(route[i])?.get(route[j]) || 0) + '\t'
        }
        content += '\n'
    }

    try {
        fs.writeFileSync(fileName, content);
        // file written successfully
    } catch (err) {
        console.error(err);
    }
    return fileName;
}

/**
 * Write the parameter file for the LKH program
 * http://webhotel4.ruc.dk/~keld/research/LKH/
 */
function writeLinKernighanHelsgaunParameterFile(routeId: string, problemFileName: string, outputFileName: string) {
    const fileName = 'lkh-input/' + routeId + '-instance.par'
    const content = 'PROBLEM_FILE = ' + problemFileName + '\n' + 'TOUR_FILE = ' + outputFileName + '\n';
    try {
        fs.writeFileSync(fileName, content);
    } catch (err) {
        console.error(err);
    }
    return fileName;
}

/**
 * Run the LKH implementation of http://webhotel4.ruc.dk/~keld/research/LKH/ on the given problem file
 */
async function runLKH(parameterFileName: string, problemFileName: string, outputFileName: string): Promise<number[]> {
    const command = `/app/LKH-2.0.10/LKH /app/${parameterFileName}`;
    console.log("running LKH on input: " + parameterFileName)

    try {
        execSync(command, {encoding: 'utf-8', stdio: 'ignore'});
    } catch (error: any) {
        if (error.code) {
            console.error(`Command failed with exit code ${error.status}: ${error.code}`);
        }
        if (error.stderr) {
            console.error('Error output:', error.stderr.toString());
        }
        console.error('Full error object:', error);
    }

    const data = fs.readFileSync(outputFileName, 'utf8');
    const lines = data.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i] == "TOUR_SECTION") {
            return lines.slice(i + 1, lines.length - 2).map(x => parseInt(x)) // remove EOF and -1
        }
    }
    fs.unlinkSync(parameterFileName)
    fs.unlinkSync(problemFileName)
    fs.unlinkSync(outputFileName)
    throw new Error("error running LKH, unexpected output: " + data)
}


/**
 * Optimize a route using LKH
 */
async function linKernighanHelsgaun(algorithmLayer: Layer, routeInfo: RouteInfo, optimizeDuration: boolean, dMatrix: Map<string, Map<string, number>>, d2Matrix: Map<string, Map<string, number>>, strategy: "classification" | "stochastic" = "classification", probabilityName?: string, pollutionThreshold?: number) {
    let route = (await getRouteByRouteInfo(algorithmLayer, routeInfo)).map((obj) => obj.id)
    const routehash: string = hash(route)
    if (LKH_HASHES.includes(routehash)) {
        console.log("already optimized this exact route")
        return routeInfo
    }
    LKH_HASHES.push(routehash)
    console.log(`lkh hash size: ${LKH_HASHES.length}`)
    const outputFileName = 'lkh-output/' + routeInfo.routeId + '-tour.tour'
    const problemFileName = writeProblemFile(routeInfo.routeId, route, dMatrix)
    const parameterFileName = writeLinKernighanHelsgaunParameterFile(routeInfo.routeId, problemFileName, outputFileName)
    const optimizedRoute = await runLKH(parameterFileName, problemFileName, outputFileName)
    const newRoute: string[] = []
    let newDistance = 0
    let newDuration = 0
    for (let i = 0; i < optimizedRoute.length; i += 1) {
        newRoute.push(route[optimizedRoute[i] - 1])
        if (i > 0) {
            newDistance += (optimizeDuration ? d2Matrix : dMatrix).get(newRoute[i - 1])?.get(newRoute[i]) || 0
            newDuration += (optimizeDuration ? dMatrix : d2Matrix).get(newRoute[i - 1])?.get(newRoute[i]) || 0
        }
    }
    console.log("LKH log: " + routeInfo.routeLength + " -> " + newDistance)
    routeInfo.routeLength = newDistance
    routeInfo.routeDuration = newDuration
    await updateRoute(algorithmLayer, "LAYER_2", routeInfo, newRoute, strategy, ENABLE_SIMULATED_ANNEALING, probabilityName, pollutionThreshold)
    return routeInfo
}

function twoOptSwap(route: string[], i: number, k: number) {
    const newRoute = route.slice(0, i)
    newRoute.push(...route.slice(i, k).reverse())
    newRoute.push(...route.slice(k))
    return newRoute
}

/**
 * Compute the total route length
 */
function computeRouteLength(distanceMatrix: Map<string, Map<string, number>>, route: string[]): number {
    let distances = []
    for (let i = 0; i < route.length - 1; i += 1) {
        const distance = distanceMatrix.get(route[i])?.get(route[i + 1])
        if (distance === undefined) {
            throw new Error(`nodes ${route[i]}->${route[i + 1]} not found in distance matrix ${distanceMatrix}`)
        }
        distances.push(distance)
    }
    return distances.reduce((acc, val) => acc + val, 0)
}

/**
 * Cross-exchange algorithm
 * for inter-route optimization
 * take care that this swaps orders in the routes, thus all routes should be from the same day
 *
 * Adapted version of cross-exchange, that takes into account that dirty locations are not allowed in clean routes
 */
async function crossExchangeNeighborhood(algorithmLayer: Layer,
                                         iteration: number,
                                         maxIteration: number,
                                         routeLayer: Layer,
                                         sol: Solution,
                                         alpha: number,
                                         cleanPickUps: string[],
                                         dirtyPickUps: string[],
                                         optimizeDuration: boolean,
                                         dMatrix: Map<string, Map<string, number>>,
                                         d2Matrix: Map<string, Map<string, number>>,
                                         numberOfTrucks: number = 1,
                                         pollutionThreshold: number,
                                         maxStopsPerRoute?: number,
                                         maxRouteLength?: number,
                                         strategy: "classification" | "stochastic" = "classification",
                                         probabilityName?: string,
                                         pollutionDistributions?: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>) {
    console.log("performing cross-exchange")
    const routeIds: string[] = Array.from(sol.routeInformation.keys())
    for (let i = 0; i < routeIds.length - 1; i += 1) {
        for (let j = i + 1; j < routeIds.length; j += 1) {
            const routeInfo1 = sol.routeInformation.get(routeIds[i])
            const routeInfo2 = sol.routeInformation.get(routeIds[j])
            if (routeInfo1 && routeInfo2) {
                await crossExchange(
                    algorithmLayer,
                    iteration,
                    maxIteration,
                    routeLayer,
                    routeInfo1,
                    routeInfo2,
                    alpha,
                    cleanPickUps,
                    dirtyPickUps,
                    optimizeDuration,
                    dMatrix,
                    d2Matrix,
                    numberOfTrucks,
                    pollutionThreshold,
                    strategy,
                    probabilityName,
                    maxStopsPerRoute,
                    maxRouteLength,
                    pollutionDistributions)
                sol.routeInformation.set(routeIds[i], routeInfo1)
                sol.routeInformation.set(routeIds[j], routeInfo2)
            }
        }
    }
    console.log("done with cross-exchange")
}

/**
 * Compute the delta distance of the cross exchange
 * returns the change in distance, but without taking into account the distance inside the changes route sections
 * this does not change total delta and is used to check if the cross exchange is feasible, but should not
 * be used to update the route length
 * @param distanceMatrix
 * @param route1
 * @param route2
 * @param start1
 * @param start2
 * @param len1
 * @param len2
 */
function crossExchangeDeltaDistance(
    distanceMatrix: Map<string, Map<string, number>>,
    route1: string[],
    route2: string[],
    start1: number,
    start2: number,
    len1: number,
    len2: number
): number {
    let oldDistanceStart1 = distanceMatrix.get(route1[start1 - 1])?.get(route1[start1])
    let oldDistanceEnd1 = distanceMatrix.get(route1[start1 + len1 - 1])?.get(route1[start1 + len1])
    let oldDistanceStart2 = distanceMatrix.get(route2[start2 - 1])?.get(route2[start2])
    let oldDistanceEnd2 = distanceMatrix.get(route2[start2 + len2 - 1])?.get(route2[start2 + len2])
    let newDistanceStart12 = distanceMatrix.get(route2[start2 - 1])?.get(route1[start1])
    let newDistanceEnd12 = distanceMatrix.get(route1[start1 + len1 - 1])?.get(route2[start2 + len2])
    let newDistanceStart21 = distanceMatrix.get(route1[start1 - 1])?.get(route2[start2])
    let newDistanceEnd21 = distanceMatrix.get(route2[start2 + len2 - 1])?.get(route1[start1 + len1])
    if (len1 === 0 && len2 === 0) {
        return 0
    }
    if (len1 === 0) {
        oldDistanceEnd1 = 0 // the one replaced edge in route1 is accounted for by oldDistanceStart1
        newDistanceStart12 = distanceMatrix.get(route2[start2 - 1])?.get(route2[start2 + len2])
        newDistanceEnd12 = 0
    }
    if (len2 === 0){
        oldDistanceEnd2 = 0 // the one replaced edge in route2 is accounted for by oldDistanceStart2
        newDistanceStart21 = distanceMatrix.get(route1[start1 - 1])?.get(route1[start1 + len1])
        newDistanceEnd21 = 0
    }
    if (oldDistanceStart1 === undefined ||
        oldDistanceEnd1 === undefined ||
        oldDistanceStart2 === undefined ||
        oldDistanceEnd2 === undefined ||
        newDistanceStart12 === undefined ||
        newDistanceEnd12 === undefined ||
        newDistanceStart21 === undefined ||
        newDistanceEnd21 === undefined
    ) {
        console.log(route1[start1 - 1])
        console.log(route1[start1])
        console.log(route1[start1 + len1 - 1])
        console.log(route1[start1 + len1])
        console.log(route2[start2 - 1])
        console.log(route2[start2])
        console.log(route2[start2 + len2 - 1])
        console.log(route2[start2 + len2])
        throw new Error(`did not find one or multiple nodes in distance matrix ${distanceMatrix}`)
    }
    const deltaDistance = newDistanceStart21 + newDistanceEnd21 - oldDistanceStart1 - oldDistanceEnd1
        + newDistanceStart12 + newDistanceEnd12 - oldDistanceStart2 - oldDistanceEnd2
    return deltaDistance
}

/**
 * compute how many clean pickups are moved to the dirty route with the given cross exchange, and subtract how many
 * clean pickups are moved from dirty to clean routes
 */
function deltaPollutedStops(cleanPickUps: string[], routeInfo1: RouteInfo, routeInfo2: RouteInfo, route1: string[], route2: string[], start1: number, start2: number, len1: number, len2: number): number {
    let res = 0
    if (routeInfo1.routeType == "clean" && routeInfo2.routeType == "dirty") {
        for (let i = start1; i <= start1 + len1; i++) {
            if (cleanPickUps.includes(route1[i])) {
                res++
            }
        }
        for (let i = start2; i <= start2 + len2; i++) {
            if (cleanPickUps.includes(route2[i])) {
                res--
            }
        }
    }
    if (routeInfo1.routeType == "dirty" && routeInfo2.routeType == "clean") {
        for (let i = start1; i <= start1 + len1; i++) {
            if (cleanPickUps.includes(route1[i])) {
                res--
            }
        }
        for (let i = start2; i <= start2 + len2; i++) {
            if (cleanPickUps.includes(route2[i])) {
                res++
            }
        }
    }
    return res;
}

/**
 * Perform a cross exchange on two routes
 */
function crossExchangeSwap(route1: string[], route2: string[], start1: number, start2: number, len1: number, len2: number): [string[], string[]] {
    const newRoute1 = route1.slice(0, start1)
    const newRoute2 = route2.slice(0, start2)
    newRoute1.push(...route2.slice(start2, start2 + len2))
    newRoute2.push(...route1.slice(start1, start1 + len1))
    newRoute1.push(...route1.slice(start1 + len1))
    newRoute2.push(...route2.slice(start2 + len2))
    return [newRoute1, newRoute2]
}

/**
 * Stochastic approximation of the change in the number of polluted stops after the specified cross exchange
 */
function stochasticDeltaPollutedStops(routeInfo1: RouteInfo, routeInfo2: RouteInfo, route1: string[], route2: string[], start1: number, start2: number, len1: number, len2: number, distribution: string, pollutionThreshold: number, pollutionDistributions: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>): number {
    if (routeInfo1.probabilityClean === undefined || routeInfo2.probabilityClean === undefined) {
        throw new Error("routeInfo does not have probability, but running stochastic strategy")
    }
    if (
        routeInfo1.pollutionDistributions === undefined || routeInfo2.pollutionDistributions === undefined) {
        throw new Error("routeInfo does not have pollutionDistributions, but running stochastic strategy")
    }
    let cleanProb1 = undefined
    let cleanProb2 = undefined
    const pollutionDistributionsNewRoute2 =
        route1.slice(start1, start1 + len1)
            .concat(route2.slice(1, start2))
            .concat(route2.slice(start2 + len2, route2.length - 1))
            .map((id) => {
                if (pollutionDistributions.get(id) === undefined) {
                    throw new Error(`pollution distribution not found for ${id}`)
                }
                return pollutionDistributions.get(id)
            })
    const pollutionDistributionsNewRoute1 =
        route2.slice(start2, start2 + len2)
            .concat(route1.slice(1, start1))
            .concat(route1.slice(start1 + len1, route1.length - 1))
            .map((id) => {
                if (pollutionDistributions.get(id) === undefined) {
                    throw new Error(`pollution distribution not found for ${id}`)
                }
                return pollutionDistributions.get(id)
            })
    if (distribution === "bayesian_prob" || distribution === "normal_prob") {
        cleanProb2 = convProb(<NormalDistribution[]>pollutionDistributionsNewRoute2, pollutionThreshold);
        cleanProb1 = convProb(<NormalDistribution[]>pollutionDistributionsNewRoute1, pollutionThreshold);
    } else if (distribution === "bayesian_prob_mixed") {
        cleanProb2 = convProbFFT(<NormalMixture[]>pollutionDistributionsNewRoute2, pollutionThreshold);
        cleanProb1 = convProbFFT(<NormalMixture[]>pollutionDistributionsNewRoute1, pollutionThreshold);
    } else if (distribution === "t_prob") {
        cleanProb2 = convProbFFT(<StudentTDistribution[]>pollutionDistributionsNewRoute2, pollutionThreshold);
        cleanProb1 = convProbFFT(<StudentTDistribution[]>pollutionDistributionsNewRoute1, pollutionThreshold);
    } else {
        throw new Error(`unknown distribution ${distribution}`)
    }
    if (cleanProb1 === undefined || cleanProb2 === undefined) {
        throw new Error("cleanProb is undefined")
    }
    /*const oldProb1 = convProb(<NormalDistribution[]>route1.slice(1, route1.length-1).map((id) => {
        if (pollutionDistributions.get(id) === undefined) {
            throw new Error(`pollution distribution not found for ${id}`)
        }
        return pollutionDistributions.get(id)
    }), pollutionThreshold)
    if (Math.round(routeInfo1.probabilityClean*10000)/10000 !== Math.round(oldProb1*10000)/10000){
        console.log("oldProb1: " + oldProb1)
        console.log("routeInfo1.probabilityClean: " + routeInfo1.probabilityClean)
    }
    assert(Math.round(routeInfo1.probabilityClean*10000)/10000 === Math.round(oldProb1*10000)/10000)*/
    return - cleanProb1 * (routeInfo1.stops - len1 + len2)
        - cleanProb2 * (routeInfo2.stops - len2 + len1)
        + routeInfo1.probabilityClean * routeInfo1.stops
        + routeInfo2.probabilityClean * routeInfo2.stops;
}

/**
 * Perform a cross exchange on two routes
 */
async function crossExchange(algorithmLayer: Layer,
                             iteration: number,
                             maxIterations: number,
                             routeLayer: Layer,
                             routeInfo1: RouteInfo,
                             routeInfo2: RouteInfo,
                             alpha: number,
                             cleanPickUps: string[],
                             dirtyPickUps: string[],
                             optimizeDuration: boolean,
                             dMatrix: Map<string, Map<string, number>>,
                             d2Matrix: Map<string, Map<string, number>>,
                             numberOfTrucks: number = 1,
                             pollutionThreshold: number,
                             strategy: "classification" | "stochastic" = "classification",
                             probabilityName?: string,
                             maxStopsPerRoute?: number,
                             maxRouteLength?: number,
                             pollutionDistributions?: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>) {
    let anythingHappened = false
    const ceHash = hash([routeInfo1.routeId, routeInfo2.routeId, alpha, strategy, probabilityName, pollutionThreshold, routeInfo1.routeLength, routeInfo2.routeLength])
    if (CE_HASHES.includes(ceHash)) {
        console.log("already optimized this exact cross exchange")
        return
    }
    CE_HASHES.push(ceHash)
    console.log(`ceHash size: ${CE_HASHES.length}`)


    let route1 = (await getRouteByRouteInfo(routeLayer, routeInfo1)).map((obj) => obj.id)
    let route2 = (await getRouteByRouteInfo(routeLayer, routeInfo2)).map((obj) => obj.id)
    let bestImprovement = 1;
    let bestCrossExhangeParams: {
        start1: number,
        start2: number,
        len1: number,
        len2: number
    } | undefined = {
        start1: 0,
        start2: 0,
        len1: 0,
        len2: 0
    }
    const c_max = 50
    let c = 0
    while (bestCrossExhangeParams !== undefined && c < c_max) {
        let accepted = 0
        let total = 0
        c += 1
        bestCrossExhangeParams = undefined
        for (let i = 1; i <= route1.length - 3; i += 1) {
            if (strategy === "classification" && routeInfo2.routeType === "clean" && (dirtyPickUps.includes(route1[i]) || dirtyPickUps.includes(route1[i + 1]))) {
                continue;
            }
            for (let j = 1; j <= route2.length - 2; j += 1) {
                if (strategy === "classification" && routeInfo1.routeType === "clean" && dirtyPickUps.includes(route2[j])) {
                    continue;
                }
                const oldDistanceStart1 = dMatrix.get(route1[i - 1])?.get(route1[i])
                const oldDistanceStart2 = dMatrix.get(route2[j - 1])?.get(route2[j])
                const newDistanceStart12 = dMatrix.get(route2[j - 1])?.get(route1[i])
                const newDistanceStart21 = dMatrix.get(route1[i - 1])?.get(route1[i + 1])
                if (oldDistanceStart1 === undefined ||
                    oldDistanceStart2 === undefined ||
                    newDistanceStart12 === undefined ||
                    newDistanceStart21 === undefined
                ) {
                    throw new Error(`did not find one or multiple nodes ${route2[j - 1]}, ${route1[i]}, ${route1[i - 1]}, ${route2[j]}  in distance matrix ${dMatrix}. `)
                }
                const deltaD = newDistanceStart21 - oldDistanceStart1 + newDistanceStart12 - oldDistanceStart2
                const iota_stops_estimate = strategy == "classification" || pollutionDistributions === undefined ?
                    deltaPollutedStops(cleanPickUps, routeInfo1, routeInfo2, route1, route2, i, j, 1, 0) :
                    stochasticDeltaPollutedStops(routeInfo1, routeInfo2, route1, route2, i, j, 1, 0, <string>probabilityName, pollutionThreshold, pollutionDistributions)
                const deltaObjCrossStart = deltaD + iota_stops_estimate * alpha
                const acceptanceProbability = ENABLE_SIMULATED_ANNEALING ? computeSAAcceptanceProbability(0, deltaObjCrossStart, computeSATemperature(INITIAL_SA_TEMPERATURE, c, c_max)) : 0
                total += 1
                //ENABLE_SIMULATED_ANNEALING && console.log(`${c}: start acceptance prob: ${acceptanceProbability.toFixed(3)}`)
                if (ENABLE_SIMULATED_ANNEALING ? acceptanceProbability >= Math.random() : deltaObjCrossStart <= 0) {
                    // possible CE start
                    // console.log(`found possible cross exchange ${deltaObjCrossStart}`)
                    accepted += 1
                    const delta_distance = crossExchangeDeltaDistance(dMatrix, route1, route2, i, j, 1, 0)
                    const delta_polluted_stops = strategy == "classification" || pollutionDistributions === undefined ?
                        deltaPollutedStops(cleanPickUps, routeInfo1, routeInfo2, route1, route2, i, j, 1, 0) :
                        stochasticDeltaPollutedStops(routeInfo1, routeInfo2, route1, route2, i, j, 1, 0, <string>probabilityName, pollutionThreshold, pollutionDistributions)
                    const newObj = delta_distance + delta_polluted_stops * alpha
                    const acceptanceProbability = ENABLE_SIMULATED_ANNEALING ? computeSAAcceptanceProbability(bestImprovement, newObj, computeSATemperature(INITIAL_SA_TEMPERATURE, c, c_max)) : 0
                    total += 1
                    // ENABLE_SIMULATED_ANNEALING && console.log(`${c}: acceptance prob: ${acceptanceProbability.toFixed(3)}`)
                    if (ENABLE_SIMULATED_ANNEALING ? acceptanceProbability >= Math.random() : newObj < bestImprovement) {
                        accepted += 1
                        // console.log(`found better cross exchange ${bestImprovement} -> ${newObj}, ${i}, ${j}, ${1}, ${0}`)
                        // console.log(`probabilityClean: ${routeInfo1.probabilityClean}, ${routeInfo2.probabilityClean}`)
                        // console.log(`deltaD: ${delta_distance}, iota_estimate: ${delta_polluted_stops}, alpha: ${alpha}`)
                        bestImprovement = newObj;
                        bestCrossExhangeParams = {
                            start1: i,
                            start2: j,
                            len1: 1,
                            len2: 0
                        }
                    }
                    for (let len1 = 1; len1 <= Math.min(i + 10, route1.length - i - 2); len1++) {
                        if (strategy == "classification" && routeInfo2.routeType == "clean" && (dirtyPickUps.includes(route1[i + len1]))) {
                            break;
                        }
                        for (let len2 = 0; len2 <= Math.min(j + 10, route2.length - j - 2); len2++) {
                            if (strategy == "classification" && routeInfo1.routeType == "clean" && dirtyPickUps.includes(route2[j + len2])) {
                                break;
                            }
                            if (maxStopsPerRoute !== undefined && (maxStopsPerRoute - routeInfo1.stops + len1 - len2 < 0 || maxStopsPerRoute - routeInfo2.stops + len2 - len1 < 0)) {
                                break;
                            }
                            const delta_distance = crossExchangeDeltaDistance(dMatrix, route1, route2, i, j, len1, len2)
                            const delta_polluted_stops = strategy == "classification" || pollutionDistributions === undefined ?
                                deltaPollutedStops(cleanPickUps, routeInfo1, routeInfo2, route1, route2, i, j, len1, len2) :
                                stochasticDeltaPollutedStops(routeInfo1, routeInfo2, route1, route2, i, j, len1, len2, <string>probabilityName, pollutionThreshold, pollutionDistributions)
                            const newObj = delta_distance + delta_polluted_stops * alpha
                            if (newObj < bestImprovement) {
                                //console.log(`found better cross exchange ${bestImprovement} -> ${newObj}, ${i}, ${j}, ${len1}, ${len2}`)
                                //console.log(`probabilityClean: ${routeInfo1.probabilityClean}, ${routeInfo2.probabilityClean}`)
                                //console.log(`deltaD: ${delta_distance}, iota_estimate: ${delta_polluted_stops}, alpha: ${alpha}`)
                                bestCrossExhangeParams = {
                                    start1: i,
                                    start2: j,
                                    len1: len1,
                                    len2: len2
                                }
                                bestImprovement = newObj;
                            }
                        }

                    }
                }
                if (bestCrossExhangeParams !== undefined) {
                    break
                }
            }
            if (bestCrossExhangeParams !== undefined) {
                console.log(bestCrossExhangeParams)
                break
            }
        }
        if (bestCrossExhangeParams !== undefined) {
            const betterRoutes = crossExchangeSwap(route1, route2, bestCrossExhangeParams.start1, bestCrossExhangeParams.start2,
                bestCrossExhangeParams.len1, bestCrossExhangeParams.len2)
            const betterRouteD = betterRoutes.map((route) => computeRouteLength(dMatrix, route))
            const betterRouteD2 = betterRoutes.map((route) => computeRouteLength(d2Matrix, route))
            console.log(`best cross exchange params: ${bestCrossExhangeParams.start1}, ${bestCrossExhangeParams.start2}, ${bestCrossExhangeParams.len1}, ${bestCrossExhangeParams.len2}`)
            console.log(`route length improvement found ${routeInfo1.routeLength} -> ${betterRouteD[0]}`)
            console.log(`route length improvement found ${routeInfo2.routeLength} -> ${betterRouteD[1]}`)


            routeInfo1.routeLength = optimizeDuration ? betterRouteD2[0] : betterRouteD[0]
            routeInfo2.routeLength = optimizeDuration ? betterRouteD2[1] : betterRouteD[1]
            routeInfo1.routeDuration = optimizeDuration ? betterRouteD[0] : betterRouteD2[0]
            routeInfo2.routeDuration = optimizeDuration ? betterRouteD[1] : betterRouteD2[1]
            routeInfo1.stops = betterRoutes[0].length - 2
            routeInfo2.stops = betterRoutes[1].length - 2
            if (strategy == "stochastic" && routeInfo1.probabilityClean !== undefined && routeInfo2.probabilityClean !== undefined) {
                if (probabilityName === undefined) {
                    throw new Error("probabilityName is undefined")
                }
                const betterRoute0PickUpDistributions = betterRoutes[0].slice(1, betterRoutes[0].length - 1).map((id) => pollutionDistributions?.get(id)) as NormalDistribution[] | NormalMixture[] | StudentTDistribution[]
                const betterRoute1PickUpDistributions = betterRoutes[1].slice(1, betterRoutes[1].length - 1).map((id) => pollutionDistributions?.get(id)) as NormalDistribution[] | NormalMixture[] | StudentTDistribution[]
                routeInfo1.pollutionDistributions = betterRoute0PickUpDistributions
                routeInfo2.pollutionDistributions = betterRoute1PickUpDistributions

                if (probabilityName === "bayesian_prob" || probabilityName === "normal_prob") {
                    routeInfo1.probabilityClean = convProb(<NormalDistribution[]>betterRoute0PickUpDistributions, pollutionThreshold)
                    routeInfo2.probabilityClean = convProb(<NormalDistribution[]>betterRoute1PickUpDistributions, pollutionThreshold)
                } else if (probabilityName === "bayesian_prob_mixed") {
                    routeInfo1.probabilityClean = convProbFFT(<NormalMixture[]>betterRoute0PickUpDistributions, pollutionThreshold)
                    routeInfo2.probabilityClean = convProbFFT(<NormalMixture[]>betterRoute1PickUpDistributions, pollutionThreshold)
                } else if (probabilityName === "t_prob") {
                    routeInfo1.probabilityClean = convProbFFT(<StudentTDistribution[]>betterRoute0PickUpDistributions, pollutionThreshold)
                    routeInfo2.probabilityClean = convProbFFT(<StudentTDistribution[]>betterRoute1PickUpDistributions, pollutionThreshold)
                }
                console.log(`after cross exchange probabilityClean: ${routeInfo1.probabilityClean}, ${routeInfo2.probabilityClean}`)
            }
            console.log(`in update route arrays`)
            route1 = []
            route1 = route1.concat(betterRoutes[0])
            route2 = []
            route2 = route2.concat(betterRoutes[1])
            bestImprovement = 1;
            anythingHappened = true
        }
        console.log(`at iteration ${c} acceptance rate: ${accepted/total} from ${total}`)
    }
    if (anythingHappened) {
        await updateRoute(algorithmLayer, "LAYER_2", routeInfo1, route1, strategy, ENABLE_SIMULATED_ANNEALING, probabilityName, pollutionThreshold)
        await updateRoute(algorithmLayer, "LAYER_2", routeInfo2, route2, strategy, ENABLE_SIMULATED_ANNEALING, probabilityName, pollutionThreshold)
    }
}

/**
 * Compute the temperature for the simulated annealing algorithm
 */
function computeSATemperature(initialTemperature: number, iteration: number, maxIterations: number): number {
    return initialTemperature * (1 - iteration / maxIterations)
}

/**
 * Compute the acceptance probability for the simulated annealing algorithm
 */
function computeSAAcceptanceProbability(incumbent: number, proposed: number, temperature: number): number {
    if (proposed < incumbent) {
        return 1
    }
    return Math.exp((incumbent - proposed) / temperature)
}

/**
 * One iteration of Local Search algorithm
 */
async function iterateLS(algorithmLayer: "LAYER_LS_STOCHASTIC" | "LAYER_LS_CLASSIFICATION" | "LAYER_LS_STOCHASTIC_NORMAL_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB_MIXED" | "LAYER_LS_STOCHASTIC_T_PROB",
                         iteration: number,
                         maxIteration: number,
                         initial: boolean,
                         sol: Solution,
                         alpha: number,
                         cleanPickUps: string[],
                         dirtyPickUps: string[],
                         optimizeDuration: boolean,
                         dMatrix: Map<string, Map<string, number>>,
                         d2Matrix: Map<string, Map<string, number>>,
                         numberOfTrucks: number = 1,
                         pollutionThreshold: number,
                         maxStopsPerRoute?: number,
                         maxRouteLength?: number,
                         strategy: "classification" | "stochastic" = "classification",
                         probabilityName?: string,
                         pollutionDistributions?: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>): Promise<[number, number, Solution]> {
    const old_obj = sol.calc_obj()
    console.log("cross exchange start")
    await crossExchangeNeighborhood(
        algorithmLayer,
        iteration,
        maxIteration,
        initial ? "LAYER_GREEDY" : algorithmLayer,
        sol,
        alpha,
        cleanPickUps,
        dirtyPickUps,
        optimizeDuration,
        dMatrix,
        d2Matrix,
        numberOfTrucks,
        pollutionThreshold,
        maxStopsPerRoute,
        maxRouteLength,
        strategy,
        probabilityName,
        pollutionDistributions)
    console.log("cross exchange done")
    const after_cross_exchange = sol.calc_obj()
    console.log("lin kernighan start")
    await linKernighanHelsgaunNeighborhood(algorithmLayer, sol, optimizeDuration, dMatrix, d2Matrix, strategy, probabilityName, pollutionThreshold, pollutionDistributions)
    console.log("lin kernighan done")
    const new_obj = sol.calc_obj()
    console.log(`iteration ${old_obj} -> CE: ${after_cross_exchange} -> LKH: ${new_obj}`)
    //assert(Math.round(old_obj) >= Math.round(after_cross_exchange))
    //assert(Math.round(after_cross_exchange) >= Math.round(new_obj))
    return [old_obj, new_obj, sol]
}

/**
 * Construction. Construct a starting solution.
 * Initial optimisation. Apply LS on starting solution.
 * while not abortion criterion is reached do
 *  Perturbation:
 *  while not a certain number of moves have been made do
 *      Penalize ‘the worst’ edge (i, j) by incrementing p(i, j).
 *      Apply LS on (i, j), using cg(·) as evaluation criterion.
 *  end while
 *  Optimisation:
 *  Apply LS on all routes that were changed during perturbation (using c(·) as evaluation criterion).
 * end while
 */
export async function localSearch(
    algorithmLayer: "LAYER_LS_STOCHASTIC" | "LAYER_LS_CLASSIFICATION" | "LAYER_LS_STOCHASTIC_NORMAL_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB_MIXED" | "LAYER_LS_STOCHASTIC_T_PROB",
    maxIteration: number,
    initialSolutionLayer: Layer = "LAYER_GREEDY",
    alpha: number = 50,
    pollutionMetric: string = "averageDayScore",
    cleanWasteThreshold: number = 0.187,
    numberOfTrucks: number = 1,
    dateString: string,
    strategy: "classification" | "stochastic" = "classification",
    enableSimulatedAnnealing = false,
    probabilityName?: string,
    optimizeDuration = false,
    maxStopsPerRoute?: number,
    maxRouteLength?: number,
) {
    let dirty = await getPickUpsByThreshold("LAYER_2", pollutionMetric, ">", cleanWasteThreshold, dateString)
    let clean = await getPickUpsByThreshold("LAYER_2", pollutionMetric, "<=", cleanWasteThreshold, dateString)
    const allNodes = dirty.concat(clean)
    ENABLE_SIMULATED_ANNEALING = enableSimulatedAnnealing
    CE_HASHES = []
    LKH_HASHES = []
    allNodes.push(await getBase("LAYER_2"))
    allNodes.push(await getDropOff("LAYER_2"))
    const distanceMatrix = await getDistanceMatrix("LAYER_2", allNodes)
    const durationMatrix = await getDurationMatrix("LAYER_2", allNodes)
    const dMatrix = optimizeDuration ? durationMatrix : distanceMatrix
    const d2Matrix = optimizeDuration ? distanceMatrix : durationMatrix
    let pollutionDistributions: Map<string, NormalDistribution | NormalMixture | StudentTDistribution>
    if (probabilityName === "bayesian_prob_mixed") {
        pollutionDistributions = await getNormalMixtureOfPickUps(allNodes, probabilityName + ".dist")
    } else if (probabilityName === "t_prob") {
        pollutionDistributions = await getStudentTDistributionOfPickUps(allNodes, probabilityName + ".dist")
    } else {
        pollutionDistributions = await getNormalDistributionOfPickUps(allNodes, probabilityName + ".dist")
    }

    console.log(`localSearch: ${alpha}, ${pollutionMetric}, ${cleanWasteThreshold}, ${numberOfTrucks}, ${dateString}, ${maxStopsPerRoute}, ${maxRouteLength}`)
    let incumbent: Solution = new Solution(await getRouteInfosFromLayer(initialSolutionLayer, dateString, 250), strategy);
    let iterationsNoImprovement = 0;
    for (let routeInfo of incumbent.routeInformation.values()) {
        const route = (await getRouteByRouteInfo(initialSolutionLayer, routeInfo)).map((obj) => obj.id)
        routeInfo.alpha = alpha
        routeInfo.routeId = randomUUID()
        await updateRoute(algorithmLayer, "LAYER_2", routeInfo, route, strategy, ENABLE_SIMULATED_ANNEALING, probabilityName, cleanWasteThreshold)
    }
    incumbent = new Solution(await getRouteInfosFromLayer(algorithmLayer, dateString, alpha), strategy); // fetch again, as the routes have been updated
    console.log(`0, ${incumbent.calc_obj()}`)
    for (let i = 0; maxIteration; i += 1) {
        if (iterationsNoImprovement > 10) {
            break
        }
        const res = await iterateLS(algorithmLayer, i, maxIteration, i == 0, incumbent, alpha, clean, dirty, optimizeDuration, dMatrix, d2Matrix, numberOfTrucks, cleanWasteThreshold, maxStopsPerRoute, maxRouteLength, strategy, probabilityName, pollutionDistributions);
        if (res[1] < res[0]) {
            console.log(`improvement: ${res[0]} -> ${res[1]}`)
            iterationsNoImprovement = 0
        } else {
            console.log(`no improvement`)
            iterationsNoImprovement += 1
        }
        console.log(`${i + 1}, ${res[1]}`)
    }
    console.log(`local search done for ${dateString}`)
}

/**
 * Class for the solution to a PCSP-day
 */
class Solution {
    routeInformation: Map<string, RouteInfo>
    // alpha is the ratio of epsilon_collect to epsilon_dispose
    alpha: number
    strategy: "classification" | "stochastic"

    constructor(routeInfos: RouteInfo[], strategy: "classification" | "stochastic") {
        this.strategy = strategy
        this.routeInformation = new Map<string, RouteInfo>();
        this.alpha = 0
        routeInfos.forEach((obj: RouteInfo) => {
            this.routeInformation.set(obj.routeId, obj)
            if (obj.alpha) {
                this.alpha = obj.alpha.valueOf();
            }

        });
    }

    /**
     * Evaluate the objective function
     */
    calc_obj(): number {
        let obj = 0
        this.routeInformation.forEach((routeInfo: RouteInfo) => {
            obj += routeInfo.routeLength
            if (this.strategy === "classification" && routeInfo.routeType === "dirty") {
                obj += routeInfo.stops * routeInfo.alpha
            }
            if (this.strategy === "stochastic" && routeInfo.probabilityClean) {
                //console.log(`route id: ${routeInfo.routeId}, probabilityClean: ${routeInfo.probabilityClean}, stops: ${routeInfo.stops}, length: ${routeInfo.routeLength}`)
                obj += (1 - routeInfo.probabilityClean) * routeInfo.stops * this.alpha
            }
        });
        return obj
    }
}

