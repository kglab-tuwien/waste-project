/**
 * This file is used to extract the status quo routes from the MongoDB database and store them in the KG
 */
import * as mongoDB from "mongodb";
import {isImageDuplicate} from "./kg-common";
import {
  createRouteEdge,
  createRouteInfoNode,
  createVisualization,
  getBase,
  getClusteredPickUpByCoordinates,
  getDistanceBetweenPickups,
  getDropOff,
  getDurationBetweenPickups,
} from "./neo4j-service";
import {randomUUID} from "crypto";

/**
 * Extracts the routes from the MongoDB database and stores them in the KG
 */
export async function extractRoutes(
  collectionNameList: string[],
  db: mongoDB.Db
) {
  console.log(`found ${collectionNameList.length} collections`)
  for (let c in collectionNameList) {
    let routeMap: Map<
      string,
      { totalDistance: number; totalDuration: number; lastPickUpId: string; routeId: string, numberOfStopInRoute: number, dateString: string, route: string[] }
    > = new Map();
    let collectionName = collectionNameList[c];
    const dateString = collectionName.split("_")[1];
    console.log(`Retrieving documents for collection: ${collectionName}`);
    let collection = db.collection(collectionName);
    let numDocuments = await collection.countDocuments();
    console.log(`found: ${numDocuments}`);
    let cursor = collection.find();
    let i = 0;
    let baseId = await getBase("LAYER_2");
    const dropOffId = await getDropOff("LAYER_2");
    const allStops = [baseId, dropOffId]
    while (await cursor.hasNext()) {
      const next = await cursor.next();
      i += 1;
      if (
        next &&
        next.status &&
        !isImageDuplicate(next) &&
        next.status.longitude <= 18.62 // 18.62 longitude is used to filter truck service route
      ) {
        const routeMapElement = routeMap.get(next.device_id);
        if (next && !(routeMapElement && routeMapElement.dateString === dateString)) {
          routeMap.set(next.device_id, {
            totalDistance: 0,
            totalDuration: 0,
            lastPickUpId: baseId,
            routeId: randomUUID(),
            numberOfStopInRoute: 0,
            dateString: dateString,
            route: [baseId]
          });
        }
        const status = next.status;
        const pickUpId: string = await getClusteredPickUpByCoordinates(
          status.latitude,
          status.longitude,
          status.altitude
        );

        const value = routeMap.get(next.device_id);
        if (value) {
          if (!allStops.includes(pickUpId) && pickUpId !== dropOffId && pickUpId !== baseId) {
            routeMap.set(
              next.device_id,
              Object.assign(value, {

                totalDistance: value.totalDistance + (await getDistanceBetweenPickups(
                    "LAYER_2",
                    value.lastPickUpId,
                    pickUpId
                )),
                totalDuration: value.totalDuration + (await getDurationBetweenPickups(
                    "LAYER_2",
                    value.lastPickUpId,
                    pickUpId
                )),
                route: value.route.concat(pickUpId)
              })
            );
            await createRouteEdge(
                "LAYER_2",
                "LAYER_PREEXISTING",
                value.routeId,
                value.lastPickUpId,
                pickUpId,
                value.numberOfStopInRoute
            );
            allStops.push(pickUpId)
            value.numberOfStopInRoute += 1;
            value.lastPickUpId = pickUpId;
          }
        }
      }
    }

    const valueIterator = routeMap.values();
    let value = valueIterator.next();
    while (value.value) {
      console.log(value.value);
      value.value.totalDistance += (await getDistanceBetweenPickups(
          "LAYER_2",
          value.value.lastPickUpId,
          dropOffId
      ))
      value.value.totalDuration +=  (await getDurationBetweenPickups(
          "LAYER_2",
          value.value.lastPickUpId,
          dropOffId
      ))
      if (value.value.lastPickUpId !== dropOffId){
        await createRouteEdge(
          "LAYER_2",
          "LAYER_PREEXISTING",
          value.value.routeId,
          value.value.lastPickUpId,
          dropOffId,
          value.value.numberOfStopInRoute
        );
      } else {
        value.value.numberOfStopInRoute -= 1;
      }
      await createRouteInfoNode(
        "LAYER_PREEXISTING",
        value.value.routeId,
        value.value.totalDistance,
        value.value.totalDuration,
        value.value.dateString,
        "dirty",
        Math.max(value.value.numberOfStopInRoute, 0),
        -1
      );
      value = valueIterator.next();
    }
  }
  await createVisualization("LAYER_2", "LAYER_PREEXISTING", "LAYER_VISUAL");
}
