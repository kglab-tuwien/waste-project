/**
 * This file provides routing services
 */
import {LocationAndIdentifier, RoutingResponse} from "./types";
import axios from "axios";

const OSRM_URL = process.env['OSRM_URL'] || ""

/**
 * takes source location, target location, and travel means returns distance in meters and travel duration in seconds
 */
export async function distanceAndDuration(source: LocationAndIdentifier, target: LocationAndIdentifier, means: "car"): Promise<RoutingResponse> {
    const url = OSRM_URL + source.longitude + "," + source.latitude + ";" + target.longitude + "," + target.latitude;
    const response = await axios.get(url)
    return {distance: response.data.routes[0].distance, duration: response.data.routes[0].duration}
}