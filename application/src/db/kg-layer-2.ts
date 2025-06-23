/**
 * This file contains the functions to create the second layer of the knowledge graph.
 */
import {
    addPreviousLayerReferenceToNode,
    createLocation,
    createNode,
    createVehicleType,
    getBase,
    getClusterIdByLocationId,
    getClustersWithAverageCoordinates,
    getDropOff,
    getNumberOf,
    kMeans,
} from "./neo4j-service";
import {createBasePoint, createDropOffPoint} from "./kg-common";
import {createDistances} from "./kg-distances";

/**
 * Creates LAYER_2 of the knowledge graph by querying the data from LAYER_1
 */
export async function createKgLayer2(withDistances: boolean | undefined) {
    const dropOffPointLocation = await createDropOffPoint("LAYER_2");
    const basePointLocation = await createBasePoint("LAYER_2");
    const travelMeans = "car"
    await createVehicleType("LAYER_2", travelMeans);
    const numberOfPickUpsInLayer1 = await getNumberOf("LAYER_1", "PickUp")
    await kMeans(Math.round(0.1 * numberOfPickUpsInLayer1)); // the actual number of bins is 10% of pickups in layer 1
    const clusters = await getClustersWithAverageCoordinates("LAYER_1")

    const clusterIdDropOff = await getClusterIdByLocationId("LAYER_2", dropOffPointLocation.id)
    const clusterIdBase = await getClusterIdByLocationId("LAYER_2", basePointLocation.id)
    for (let c of clusters) {
        let nodeId = ""
        if (c.clusterId === clusterIdBase) {
            nodeId = (await getBase("LAYER_2"))
        } else if (c.clusterId === clusterIdDropOff) {
            nodeId = (await getDropOff("LAYER_2"))
        } else {
            const geoId  = await createLocation("LAYER_2", c.lng, c.lat, c.alt)
            nodeId =  await createNode("LAYER_2", geoId, "PickUp")
        }
        await addPreviousLayerReferenceToNode("LAYER_2", "LAYER_1", nodeId, c.clusterId);
    }
    if (withDistances){
        await createDistances("LAYER_2")
    }
}
