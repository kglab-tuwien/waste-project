/**
 * This file contains functions to create distances between all unconnected locations in a layer
 */
import {LocationAndIdentifier, RoutingResponse} from "../types";
import {distanceAndDuration} from "../routing-service";
import {
    connectKG,
    createNodeComponent,
    disconnectKG,
    dropDistances,
    getUnconnectedLocations,
    getVehicleType
} from "./neo4j-service";
import {Layer} from "./layer";

/**
 * creates distances between all unconnected locations in layer 2
 */
export async function deleteDistances(layer: Layer){
    await dropDistances(layer)
}

/**
 * creates distance between two locations
 */
async function createDistance(l1: LocationAndIdentifier, l2: LocationAndIdentifier, vehicleTypeId: string, layer: Layer) {
    const l1ToL2: RoutingResponse = await distanceAndDuration(l1, l2, "car")
    vehicleTypeId && l1.id && l2.id && await createNodeComponent(layer,
        l1ToL2.duration,
        l1ToL2.distance,
        vehicleTypeId,
        "OSRM",
        l1.id,
        l2.id)
}

/**
 * creates distances between all unconnected locations in specified layer for specified vehicle type
 */
async function createDistancesForVehicleType(layer: Layer, vehicleTypeId: string) {
    const unconnectedLocations: [LocationAndIdentifier, LocationAndIdentifier][] = await getUnconnectedLocations(layer)
    for (const [l1, l2] of unconnectedLocations) {
        await createDistance(l1, l2, vehicleTypeId, layer);
    }
    return unconnectedLocations.length
}

/**
 * creates distances between all unconnected locations in specified layer
 */
export async function createDistances(layer: Layer){

    const travelMeans = "car"
    const vehicleTypeId = await getVehicleType(layer, travelMeans);
    let i = 1;
    while (i > 0){
        await disconnectKG()
        await connectKG()
        i = await createDistancesForVehicleType(layer, vehicleTypeId)
    }
    console.log(`finished creating distances between all unconnected locations in layer ${layer}`)
}
