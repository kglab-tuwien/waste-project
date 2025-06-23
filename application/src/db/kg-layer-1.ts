/**
 * This file contains the functions to create the first layer of the knowledge graph.
 */
import {
    addReportToNode,
    computeReportScores,
    createLocation,
    createNode,
    createReport,
    createStatus,
    createTag,
    createTrashType,
    getNodeByGeoId,
    getTrashTypeIdByLabel
} from "./neo4j-service";
import {LocationAndIdentifier} from "../types";
import * as mongoDB from 'mongodb'
import {createBasePoint, createDropOffPoint, isImageDuplicate} from "./kg-common";


const trashTypePollutionMap = new Map([
    ["cardboard_box", 0.02],
    ["cardboard_box_pizza", 0.01],
    ["metal_can", 0.05],
    ["metal_can_fe", 0.05],
    ["cardboard_gvk_p", 0.05],
    ["metal_can_bottle", 0.05],
    ["paper", 0.01],
    ["pp-ps_cup", 0.08],
    ["plastic_bag", 0.1],
    ["pet_blue", 0.04],
    ["plastic_pot", 0.08],
    ["plastic_bag_color", 0.1],
    ["pet_trans", 0.04],
    ["plastic_pod_s", 0.08],
    ["pp-ps_box_rectangular", 0.08],
    ["plastic_can", 0.08],
    ["pp-ps_box_round", 0.08],
    ["plastic_box", 0.08],
    ["plastic_foil", 0.1],
    ["plastic_foil_slice-package", 0.08],
    ["pet_green", 0.04],
    ["plastic_pod_wash", 0.1],
    ["plastic_mkf_p", 0.1],
    ["plastic_gravelight", 0.1],
    ["analyse_data_sts_one", 0],
    ["math_count", 0],
    ["paper_bag", 0.01],
    ["cardboard_cup", 0.05],
    ["cardboard_gvk", 0.05],
    ["glas_bottle", 0.1],
    ["bio_bag_comp", 0],
    ["metal_can_rb", 0.05],
    ["bucket", 0.3]
]);

/**
 * Creates LAYER_1 of the knowledge graph by extracting the data from the MongoDB database
 */
export async function createKgLayer1(collectionNameList: string[], db: mongoDB.Db) {
    await createDropOffPoint("LAYER_1");
    await createBasePoint("LAYER_1");
    const createdLocations: Array<LocationAndIdentifier> = []
    const createdTrashTypes: Array<String> = []
    for (let ci = 0; ci < collectionNameList.length; ci++) {
        let collectionName = collectionNameList.at(ci)
        if (collectionName) {
            console.log(`Retrieving documents for collection: ${collectionName}`)
            console.log(`Creation progress: ${ci + 1}/${collectionNameList.length}`)
            let collection = db.collection(collectionName)
            let numDocuments = await collection.countDocuments()
            console.log(`found: ${numDocuments}`)
            let cursor = collection.find()
            let i = 0
            while ((await cursor.hasNext())) {
                const next = await cursor.next()
                i += 1
                if (next && next.status && !isImageDuplicate(next) && next.status.longitude <= 18.62) { // 18.62 is the longitude where truck service routes begin
                    const status = next.status
                    const foundLocation = createdLocations.find(x =>
                        x.latitude == status.latitude &&
                        x.longitude == status.longitude &&
                        x.altitude == status.altitude)
                    let nodeId;
                    if (!foundLocation) {
                        const geoId: string = await createLocation("LAYER_1", status.longitude, status.latitude, status.altitude, ci + "")
                        nodeId = await createNode("LAYER_1", geoId, "PickUp")
                        createdLocations.push(
                            {
                                latitude: status.latitude,
                                longitude: status.longitude,
                                altitude: status.altitude,
                                id: geoId
                            }
                        )
                    } else {
                        nodeId = foundLocation.id && await getNodeByGeoId("LAYER_1", foundLocation.id);
                    }
                    const timestamp = new Date(status.timestamp)
                    const timestampLastMove = new Date(status['gps-timestamp-last-move'] * 1000)
                    const statusId = await createStatus("LAYER_1", timestamp, timestampLastMove)
                    const trashTypeIds: Array<String> = []

                    const reportId = await createReport("LAYER_1", statusId);
                    if (next.taggers) {
                        for (let tagger of next.taggers) {
                            for (let tag of tagger.tags) {
                                const label: string = tag.label
                                const score: number = tag.score || 1
                                const foundTrashType = createdTrashTypes.find(x => x == label)
                                if (!foundTrashType) {
                                    let severity = trashTypePollutionMap.get(label);
                                    if (!severity) {
                                        console.warn(`severity for label ${label} undefined`)
                                        severity = 0;
                                    }
                                    trashTypeIds.push(await createTrashType("LAYER_1", label, severity))
                                    createdTrashTypes.push(label)
                                } else {
                                    trashTypeIds.push(await getTrashTypeIdByLabel("LAYER_1", label))
                                }
                                await createTag("LAYER_1", label, score, reportId)
                            }
                        }
                    }
                    await addReportToNode("LAYER_1", reportId, nodeId);
                }
            }
        }
    }
    await computeReportScores("LAYER_1")
    console.log("Creation layer 1 finished")
}