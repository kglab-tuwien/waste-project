/**
 * Common utility functions for Knowledge Graph creation
 */
import {createBase, createDropOff, createLocation} from "./neo4j-service";
import {Document} from "mongodb";
import {Layer} from "./layer";

const dropOffLatitude = Number(process.env['DROP_OFF_LATITUDE']) || 48;
const dropOffLongitude = Number(process.env['DROP_OFF_LONGITUDE']) || 18;
const baseLatitude = Number(process.env['BASE_LATITUDE']) || 48;
const baseLongitude = Number(process.env['BASE_LONGITUDE']) || 18;

/**
 * Creates a drop-off point in the knowledge graph
 */
export async function createDropOffPoint(layer: Layer) {
    const altitude = 0
    const geoId: string = await createLocation(layer, dropOffLongitude, dropOffLatitude, altitude)
    await createDropOff(layer, geoId)
    return {
        latitude: dropOffLatitude,
        longitude: dropOffLongitude,
        altitude: altitude,
        id: geoId
    };
}

/**
 * Creates the base location in the knowledge graph
 */
export async function createBasePoint(layer: Layer) {
    const altitude = 0
    const geoId: string = await createLocation(layer, baseLongitude, baseLatitude, altitude)
    await createBase(layer, geoId)
    return {
        latitude: baseLatitude,
        longitude: baseLongitude,
        altitude: altitude,
        id: geoId
    };
}

/**
 * Checks if the report (i.e., metadata for an image) identifies it as a duplicate
 */
export function isImageDuplicate(next: Document) {
    if (!next.taggers){
        // no tags = no image duplicate
        return false;
    }
    for (let tagger of next.taggers) {
        for (let tag of tagger.tags) {
            const label: String = tag.label
            if (label == "image_duplicate") {
                return true;
            }
        }
    }
    return false;
}