import {
    createRouteEdges,
    createRouteInfoNode,
    dropLayer,
    getBase,
    getDistanceMatrix,
    getDropOff,
    getDurationMatrix,
    getPickUpsByThreshold
} from "../neo4j-service";
import {randomUUID} from "crypto";
import {PickUpCandidate} from "../../types";
import {getMatrixEntry} from "../utils";


/**
 * First, apply pollution threshold to divide pick ups in clean and dirty. Then, create a single dirty and clean route
 * in a greedy fashion. Next, for each clean pick up: Check if distance added to clean route minus the allowed extra
 * distance (alpha) is larger than the distance that would be added to the dirty route.
 * Add to dirty route and remove from clean if applicable.
 * Finally, split single routes into multiple routes to satisfy max route length or max stops.
 *
 *
 * @param numberOfTrucks the number of trucks/vehicles to serve the routes
 * @param maxStopsPerRoute maximum number of stops per route
 * @param maxRouteLength maximum route length
 * @param alpha how much an extra stop in the clean waste collection is allowed to contribute in additional CO2 emissions (route length) [0-1]
 * @param pollutionMetric pollution metric used for optimization
 *                        averageDayCountHeavy, worstDayCountHeavy, averageDayCountPlastic, worstDayCountPlastic,
 *                        averageDayScore, worstDayScore
 * @param cleanWasteThreshold pick up points with pollution score less than
 * @param optimizeDuration if true, optimize for duration instead of distance
 * @param dateString date for which to solve the problem
 */
export async function greedySolve(alpha: number = 50, pollutionMetric: string = "averageDayScore", cleanWasteThreshold: number = 0.187, numberOfTrucks: number = 1, dateString: string, optimizeDuration: boolean = false, maxStopsPerRoute?: number, maxRouteLength?: number){
    console.log(`greedySolve: ${alpha}, ${pollutionMetric}, ${cleanWasteThreshold}, ${numberOfTrucks}, ${dateString}, ${maxStopsPerRoute}, ${maxRouteLength}`)

    let clean = alpha === 0 ?
        [] : await getPickUpsByThreshold("LAYER_2", pollutionMetric, "<=", cleanWasteThreshold, dateString)
    let dirty = alpha === 0 ?
        await getPickUpsByThreshold("LAYER_2", "averageDayScore", ">", -1, dateString) : await getPickUpsByThreshold("LAYER_2", pollutionMetric, ">", cleanWasteThreshold, dateString)

    console.log(`found ${dirty.length} dirty and ${clean.length} clean pick ups for ${dateString}`)
    const allNodes = dirty.concat(clean)
    allNodes.push(await getBase("LAYER_2"))
    allNodes.push(await getDropOff("LAYER_2"))
    const distanceMatrix = await getDistanceMatrix("LAYER_2", allNodes)
    const durationMatrix = await getDurationMatrix("LAYER_2", allNodes)
    const dMatrix = optimizeDuration ? durationMatrix : distanceMatrix
    const d2Matrix = optimizeDuration ? distanceMatrix : durationMatrix

    const dirtyRoutingResponse = await routesForPickUpSet(dirty, dMatrix, undefined, undefined);
    const dirtyRoute = dirtyRoutingResponse[1].length > 0 ? dirtyRoutingResponse[1][0] : [] // first and only route in response, route length constraints undefined

    const cleanRoutingResponse = await routesForPickUpSet(clean, dMatrix, undefined, undefined);
    let cleanRoute = cleanRoutingResponse[1].length > 0 ? cleanRoutingResponse[1][0] : [] // first and only route in response, route length constraints undefined

    console.log(`dirty initial length: ${dirtyRoute.length}`)
    console.log(`clean initial length: ${cleanRoute.length}`)

    while (clean.length > 0) {
        const idx = cleanRoute.indexOf(clean[0])
        const distanceWithStop = getMatrixEntry(dMatrix, cleanRoute[idx-1], cleanRoute[idx]) +
            getMatrixEntry(dMatrix, cleanRoute[idx], cleanRoute[idx+1])
        const distanceWithoutStop = getMatrixEntry(dMatrix, cleanRoute[idx-1], cleanRoute[idx+1])

        let bestClean: PickUpCandidate = {
            id: clean[0],
            distance: distanceWithStop - distanceWithoutStop
        }

        let foundBetterDirty = false;
        let bestDirtyDistance = 0;
        for (let stopIndex = 0; stopIndex < dirtyRoute.length - 1; stopIndex ++){
            let distInDirty = getMatrixEntry(dMatrix, dirtyRoute[stopIndex], bestClean.id) +
                getMatrixEntry(dMatrix, bestClean.id, dirtyRoute[stopIndex + 1]) -
                getMatrixEntry(dMatrix, dirtyRoute[stopIndex], dirtyRoute[stopIndex + 1])
            if ((!foundBetterDirty || bestDirtyDistance > distInDirty) && distInDirty < bestClean.distance - alpha){
                bestClean.sourceIndex = stopIndex
                bestClean.targetIndex = stopIndex + 1
                foundBetterDirty = true
                bestDirtyDistance = distInDirty;
            }
        }
        if (foundBetterDirty){
            console.log(`adding ${bestClean.id} to dirty route`)
            dirty.push(bestClean.id)
            bestClean.sourceIndex !== undefined && dirtyRoute.splice(bestClean.sourceIndex + 1, 0, bestClean.id)
            cleanRoute = cleanRoute.filter(x => x != bestClean.id)
        }
        clean = clean.filter(x => x != bestClean.id)
    }
    console.log(`dirty after alpha length: ${dirtyRoute.length}`)
    console.log(`clean after alpha length: ${cleanRoute.length}`)

    await splitAndWriteRoute(cleanRoute, optimizeDuration, dMatrix, d2Matrix, alpha, maxRouteLength, maxStopsPerRoute, "clean", dateString, pollutionMetric, cleanWasteThreshold);
    await splitAndWriteRoute(dirtyRoute, optimizeDuration, dMatrix, d2Matrix, alpha, maxRouteLength, maxStopsPerRoute, "dirty", dateString, pollutionMetric, cleanWasteThreshold);
    console.log(`greedy done for ${dateString}`)
}

function findClosestNode(lastNodeId: string, distanceMatrix: Map<string, Map<string, number>>, availablePickUps: string[], remainingAllowedDistance: undefined | number, dropOff: string) {
    const distances = distanceMatrix.get(lastNodeId)
    let minDistance = Number.MAX_VALUE
    let minNodeId = undefined
    if (distances === undefined) {
        return undefined
    }
    for (let nodeId of availablePickUps) {
        const distancesFromNodeId = distanceMatrix.get(nodeId)
        if (distancesFromNodeId === undefined){
            continue
        }
        const distanceToDropOff = distancesFromNodeId.get(dropOff)
        if (distanceToDropOff === undefined){
            continue
        }
        const relevantDistance = distances.get(nodeId)
        if (relevantDistance === undefined) {
            continue
        }
        const totalDistance = relevantDistance + distanceToDropOff
        if ((!remainingAllowedDistance || totalDistance < remainingAllowedDistance) && relevantDistance < minDistance) {
            minDistance = relevantDistance
            minNodeId = nodeId
        }
    }
    return minNodeId
}

/**
 * Applies nearest neighbor heuristic to construct routes for a set of pick up stops
 */
export async function routesForPickUpSet(availablePickUps: string[],
                                         dMatrix: Map<string, Map<string, number>>,
                                         maxStopsPerRoute: number | undefined,
                                         maxRouteLength: number | undefined): Promise<[number, string[][]]> {
    const baseNode: string = await getBase("LAYER_2");
    const dropOff: string = await getDropOff("LAYER_2");
    let totalRouteLength = 0;
    const routes = []
    while (availablePickUps.length > 0) {
        const route = [baseNode]
        let numberOfStops = 0;
        let routeLength = 0;
        let lastNodeId = baseNode;
        let newNodeId = findClosestNode(lastNodeId, dMatrix, availablePickUps, maxRouteLength && maxRouteLength - routeLength, dropOff); // PickUp
        while (newNodeId && (!maxStopsPerRoute || numberOfStops < maxStopsPerRoute) && availablePickUps.length > 0) {
            availablePickUps = availablePickUps.filter(x => x != newNodeId)
            console.log(`route planning remaining pick ups: ${availablePickUps.length}`)
            const distance = getMatrixEntry(dMatrix, lastNodeId, newNodeId)
            route.push(newNodeId)
            numberOfStops++;
            routeLength += distance;
            lastNodeId = newNodeId;
            newNodeId = findClosestNode(lastNodeId, dMatrix, availablePickUps, maxRouteLength && maxRouteLength - routeLength, dropOff); // PickUp
        }
        const distance = getMatrixEntry(dMatrix, lastNodeId, dropOff)
        routeLength += distance;
        route.push(dropOff)
        totalRouteLength += routeLength;
        routes.push(route)
    }
    return [totalRouteLength, routes];
}

/**
 * Writes a route to the KG
 */
async function writeRoute(edges: [string, string, number?][], distance: number, duration: number, dateString: string, routeType: "clean" | "dirty", stops: number, alpha: number, maxRouteLength: number | undefined, maxStopsPerRoute: number | undefined, pollutionMetric: string, cleanWasteThreshold: number) {
    const cleanRouteId = randomUUID()
    await createRouteEdges("LAYER_2", "LAYER_GREEDY", cleanRouteId, edges)
    await createRouteInfoNode("LAYER_GREEDY", cleanRouteId, distance, duration, dateString, routeType, stops, alpha, maxRouteLength, maxStopsPerRoute, pollutionMetric, cleanWasteThreshold)
}

/**
 * dMatrix and d2Matrix are distances and durations respectively, if optimizeDuration then in the specified (dist, dur)
 * order otherwise reversed
 */
async function splitAndWriteRoute(route: string[], optimizeDuration: boolean, dMatrix: Map<string, Map<string, number>>, d2Matrix: Map<string, Map<string, number>>, alpha: number, maxRouteLength: number | undefined, maxStopsPerRoute: number | undefined, routeType: "clean" | "dirty", dateString: string, pollutionMetric: string, cleanWasteThreshold: number) {
    if (route.length === 0) return;
    let totalD: number = 0;
    let totalD2: number = 0;
    let stops: number = 0;
    const base = await getBase("LAYER_2")
    const dropOff = await getDropOff("LAYER_2")
    let previousNode = base
    let edges: [string, string, number?][] = []
    for (let i = 1; i < route.length - 1; i++) {
        // if the next node is still plausible (< max stops and max totalD including trip to dropoff)
        const dToNewNode = getMatrixEntry(dMatrix, previousNode, route[i])
        const d2ToNewNode = getMatrixEntry(d2Matrix, previousNode, route[i])
        const maxDAdded = dToNewNode + getMatrixEntry(dMatrix, route[i], dropOff)

        if ((!maxRouteLength || totalD + maxDAdded <= maxRouteLength) && (!maxStopsPerRoute || stops + 1 <= maxStopsPerRoute)) {
            edges.push([previousNode, route[i], stops])
            totalD += dToNewNode
            totalD2 += d2ToNewNode
            previousNode = route[i]
            stops++
        } else {
            totalD += getMatrixEntry(dMatrix, previousNode, dropOff)
            totalD2 += getMatrixEntry(d2Matrix, previousNode, dropOff)
            edges.push([previousNode, dropOff, stops])
            if (optimizeDuration) {
                await writeRoute(edges, totalD2, totalD, dateString, routeType, stops, alpha, maxRouteLength, maxStopsPerRoute, pollutionMetric, cleanWasteThreshold);
            } else {

                await writeRoute(edges, totalD, totalD2, dateString, routeType, stops, alpha, maxRouteLength, maxStopsPerRoute, pollutionMetric, cleanWasteThreshold);
            }
            edges = []
            previousNode = base
            totalD = 0
            totalD2 = 0
            stops = 0
            i--
        }
    }
    totalD += getMatrixEntry(dMatrix, previousNode, dropOff)
    totalD2 += getMatrixEntry(d2Matrix, previousNode, dropOff)
    edges.push([previousNode, dropOff, stops])
    if (optimizeDuration) {
        await writeRoute(edges, totalD2, totalD, dateString, routeType, stops, alpha, maxRouteLength, maxStopsPerRoute, pollutionMetric, cleanWasteThreshold);
    } else {
        await writeRoute(edges, totalD, totalD2, dateString, routeType, stops, alpha, maxRouteLength, maxStopsPerRoute, pollutionMetric, cleanWasteThreshold);
    }
}