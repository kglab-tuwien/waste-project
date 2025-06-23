/**
 * This file contains the query wrappers to interact with the knowledge graph.
 */
import neo4j, {Session} from "neo4j-driver"
import {randomUUID} from "crypto";
import {Layer} from "./layer";
import {
    LocationAndIdentifier,
    NormalDistribution,
    NormalMixture,
    PickUpInfo,
    RouteInfo,
    SolutionInfo,
    StudentTDistribution
} from "../types";
import {convProb, convProbFFT} from "./utils";
import {write} from "node:fs";

const USER = `neo4j`
const URI = process.env['KG_URI'] || ""
const PASSWORD = process.env['KG_PASSWORD'] || ""

let writeSession: Session | null
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), {disableLosslessIntegers: true, maxConnectionPoolSize: 50,})

export async function connectKG() {
    try {
        console.log(`Trying to connect to KG at ${URI}`)
        const serverInfo = await driver.getServerInfo()
        console.log(`Connection established`)
        console.log(serverInfo)
        writeSession = driver.session()
    } catch (err: any) {
        console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    }
}

export function sessionInUse() {
    return !!writeSession
}

export async function disconnectKG() {
    writeSession && await writeSession.close()
    writeSession = null
}

/**
 * Creates a location node in the knowledge graph.
 */
export async function createLocation(layer: Layer, longitude: number, latitude: number, altitude: number, collectionTag?: string) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const id = randomUUID().toString()
    console.log(`creating Location`)
    await writeSession.run(
        `CREATE (a:Location:${layer} {id: $id, lng: $longitude, lat: $latitude, altitude: $altitude, layer: $layer, collectionTag: $collectionTag, embedding: $embedding}) RETURN a`,
        {
            id: id,
            longitude: longitude,
            latitude: latitude,
            altitude: altitude,
            layer,
            collectionTag: collectionTag || '',
            embedding: [longitude, latitude, 0]
        }
    )
    return id
}

/**
 * Creates a status node in the knowledge graph.
 */
export async function createStatus(layer: Layer, timestamp: Date, timestampLastMove: Date) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const id = randomUUID().toString()
    console.log(`creating Status`)
    await writeSession.run(
        `CREATE (a:Status:${layer} {id: $id, timestamp: localdatetime($timestamp), timestampLastMove: localdatetime($timestampLastMove)}) RETURN a`,
        {
            id: id,
            timestamp: timestamp.toISOString().slice(0, 19), // 2021-10-06T14:00:00
            timestampLastMove: timestampLastMove.toISOString().slice(0, 19)
        }
    )
    return id
}

/**
 * Creates a trash type node in the knowledge graph.
 */
export async function createTrashType(layer: Layer, label: String, severity: number = 1) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const id = randomUUID().toString()
    console.log(`creating TrashType`)
    await writeSession.run(
        `CREATE (a:TrashType:${layer} {id: $id, label: $label, severity: $severity}) RETURN a`,
        {id: id, label: label, severity: severity}
    )
    return id
}

/**
 * Creates a tag node in the knowledge graph.
 */
export async function createTag(layer: Layer, label: String, probability: number, reportId: String) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const id = randomUUID().toString()
    console.log(`creating Tag relation`)
    await writeSession.run(
        `MATCH (type:${layer}) WHERE type.label=$label 
        MATCH (report:${layer}) WHERE report.id=$reportId
        CREATE (report)-[r:tag]->(type)
        SET r.probability=$probability`,
        {id: id, label: label, probability: probability, reportId: reportId}
    )
}

/**
 * Creates a report node in the knowledge graph.
 */
export async function createReport(layer: Layer, statusId: String) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const id = randomUUID().toString()
    console.log(`creating Report`)
    await writeSession.run(
        `MATCH (status:${layer}) ` +
        `WHERE status.id=$statusId ` +
        `CREATE (a:Report:${layer} {id: $id}) ` +
        `CREATE (a)-[r:status]->(status)`,
        {id: id, statusId: statusId}
    )
    return id
}

/**
 * Creates a drop off node in the knowledge graph.
 */
export async function createDropOff(layer: Layer, geoId: String) {
    return createNode(layer, geoId, "DropOff")
}

/**
 * Creates a base node in the knowledge graph.
 */
export async function createBase(layer: Layer, geoId: String) {
    return createNode(layer, geoId, "Base")
}

/**
 * Query the base node id
 */
export async function getBase(layer: Layer) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const result = await session.run(
        `MATCH (x:Base:${layer}) RETURN x.id`,
        {}
    );
    await session.close()
    return result.records[0].get(0)
}

/**
 * Query the drop off node id
 */
export async function getDropOff(layer: Layer) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const result = await session.run(
        `MATCH (x:DropOff:${layer}) RETURN x.id`,
        {}
    );
    await session.close()
    return result.records[0].get(0)
}

/**
 * Creates a tour-stop node (= pick up, base, drop-off) in the knowledge graph.
 */
export async function createNode(layer: Layer, geoId: String, type: String = "Node") {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return ''
    }
    const id = randomUUID().toString()
    console.log(`creating ` + type)
    await writeSession.run(
        `MATCH (geo:${layer}) WHERE geo.id=$geoId CREATE (d:${type}:${layer} {id: $id}) CREATE (d)-[r:location]->(geo)`,
        {geoId: geoId, id: id}
    )
    return id
}

/**
 * Adds a reference to the node with nodeId in upperLayer, referencing all nodes that match geo coordinates in lowerLayer
 */
export async function addPreviousLayerReferenceToNode(upperLayer: Layer, lowerLayer: Layer, nodeId: String, clusterId: number) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`creating reference to previous layer for node ${nodeId},
    cluster id ${clusterId}`)
    await writeSession.run(
        `MATCH (p:${upperLayer}), (p2:${lowerLayer})-[:location]->(l:Location:LAYER_1)
        WHERE p.id=$nodeId AND l.cluster_id=$cluster
        CREATE (p)-[r:contains]->(p2)`,
        {nodeId, cluster: clusterId}
    )
}

/**
 * Creates a connectsTo edge between two nodes in the knowledge graph annotated with infos such as distance and duration.
 */
export async function createNodeComponent(layer: Layer,
                                          duration: number,
                                          distance: number,
                                          vehicleTypeId: String,
                                          calculationType: String,
                                          sourceId: String,
                                          targetId: String) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    const id = randomUUID()
    await writeSession.run(
        `MATCH (source:${layer}) WHERE source.id=$sourceId
        MATCH (target:${layer}) WHERE target.id=$targetId
        CREATE (source)-[r:connectsTo]->(target)
        SET r.distance=$distance, r.duration=$duration, r.vehicleTypeId=$vehicleTypeId, r.calculationType=$calculationType`,
        {sourceId, targetId, distance, duration, vehicleTypeId, calculationType}
    )
    return id
}

/**
 * Creates a vehicle type node in the knowledge graph.
 */
export async function createVehicleType(layer: Layer, name: String) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    const id = randomUUID()
    console.log(`creating vehicle type: ` + name)
    await writeSession.run(
        `CREATE (d:VehicleType:${layer} {id: $id, name: $name})`,
        {id: id, name: name}
    )
    return id.toString()
}

/**
 * Query the vehicle type id by name
 */
export async function getVehicleType(layer: Layer, name: String) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`get vehicle type id for: ` + name)
    const result = await session.run(
        `
        match (d:VehicleType:${layer} {name: $name})
        return d.id
        `,
        {name: name}
    )
    await session.close()
    return result.records[0].get(0)
}

/**
 * Query up to 1000 pairs of unconnected locations
 */
export async function getUnconnectedLocations(layer: Layer): Promise<[LocationAndIdentifier, LocationAndIdentifier][]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log(`get 1000 unconnected location pairs`)
    const result = await session.run(
        `
            match (l:Location:${layer}), (l2:Location:${layer})
            where NOT EXISTS (
              (l)-[:connectsTo]->(l2)
            ) AND NOT(id(l)=id(l2))
            return l, l2
            limit 1000
        `,
        {}
    )
    await session.close()
    return result.records.map(x => ([{
        id: x.get("l").properties.id,
        latitude: x.get("l").properties.lat,
        longitude: x.get("l").properties.lng,
        altitude: x.get("l").properties.altitude
    }, {
        id: x.get("l2").properties.id,
        latitude: x.get("l2").properties.lat,
        longitude: x.get("l2").properties.lng,
        altitude: x.get("l2").properties.altitude
    }]));
}

/**
 * Query trash type id by label
 */
export async function getTrashTypeIdByLabel(layer: Layer, label: String) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const result = await session.run(
        `MATCH (x:${layer}) WHERE x.label=$label RETURN x.id`,
        {label: label}
    );
    await session.close()
    return result.records[0].get(0)
}

/**
 * Query tour-stop node by id
 */
export async function getNodeByGeoId(layer: Layer, geoId: String) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const result = await session.run(
        `MATCH (x:${layer})-[r:location]-(l) WHERE l.id=$geoId RETURN x.id`,
        {geoId: geoId}
    );
    await session.close()
    return result.records[0].get(0)
}

/**
 * Query location by tour-stop node id
 */
export async function getLocationByNodeId(layer: Layer, nodeId: String): Promise<[number, number]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return [0, 0]
    }
    const result = await session.run(
        `MATCH (x:${layer})-[r:location]->(l:Location) 
        WHERE x.id=$nodeId 
        RETURN l.lat as lat, l.lng as lng
    `,
        {nodeId: nodeId}
    )
    await session.close()
    return [result.records[0].get("lat"), result.records[0].get("lng")];
}

/**
 * Get all pick up stops that share the given location
 */
export async function getClusteredPickUpByCoordinates(latitude: number, longitude: number, altitude: number): Promise<string> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    const result = await session.run(
        `
        MATCH (l:Location)-[r2:location]-(l2:LAYER_1)<-[r:contains]-(p:LAYER_2)
        WHERE l.lat=$latitude and l.lng=$longitude and l.altitude=$altitude
        RETURN p.id`,
        {latitude, longitude, altitude}
    );
    await session.close()
    return result.records[0].get(0)
}

/**
 * Link report to pick up stop in the knowledge graph
 */
export async function addReportToNode(layer: Layer, reportId: String, nodeId: String) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`added report to node`)
    await writeSession.run(
        `
        MATCH (report:${layer}) WHERE report.id=$reportId 
        MATCH (node:${layer}) WHERE node.id=$nodeId
        CREATE (node)-[r:report]->(report)
        `,
        {reportId: reportId, nodeId: nodeId, layer: layer}
    )
}

/**
 * drop all nodes and relations in the knowledge graph
 */
export async function dropAll() {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`drop all`)
    await writeSession.run(
        `
        MATCH (n) DETACH DELETE n;
        `,
        {}
    )
}

/**
 * drop all nodes and relations in the knowledge graph matching the given layer
 */
export async function dropLayer(layer: Layer) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`drop layer ${layer}`)
    await writeSession.run(
        `
        MATCH (n:${layer}) DETACH DELETE n;
        `,
        {}
    )
    await writeSession.run(
        `
        MATCH (x)-[r:${layer}]-(x2) DETACH DELETE r;
        `,
        {}
    )
}

/**
 * Drop all matching distance edges from the knowledge graph
 */
export async function dropDistances(layer: Layer) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`drop distances from layer ${layer}`)
    await writeSession.run(
        `
        MATCH (:${layer})-[r:connectsTo]->(:${layer}) DETACH DELETE r;
        `,
        {}
    )
}

/**
 * Drop all nodes and relations in the knowledge graph except the given layers
 */
export async function dropAllExcept(layers: Layer[]) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    if (layers.length === 0) {
        await dropAll()
        return
    }

    let filterString = "WHERE ";
    for (let layer of layers) {
        filterString += `not "${layer}" in LABELS(n) AND`
    }
    filterString = filterString.substring(0, filterString.length - 3)

    console.log(`drop all except ${layers}`)
    await writeSession.run(
        `
        MATCH (n) 
        ${filterString} 
        DETACH DELETE n
        `,
        {}
    )
}

/**
 * Get all pick up stops in the knowledge graph matching the criteria (layer, date, pollution metric, pollution threshold)
 * In particular, this allows to filter pick up stops by a pollution metric and pollution threshold.
 */
export async function getPickUpsByThreshold(layer: Layer, metric: String, operator: "<" | "<=" | ">" | ">=" | "=", threshold: Number, dateString: string): Promise<string[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log(`get pick up with property ${metric} ${operator} ${threshold} ${dateString}`)
    const result = await session.run(
        `
            MATCH (p:PickUp:${layer})
            where p.${metric} ${operator} ${threshold}
            call {
              with p
              match (p)-[:contains]->(:PickUp:LAYER_1)-[:report]->(:Report)-[:status]->(s:Status)
              where s.timestamp.year=${parseInt(dateString.slice(0, 4))} and s.timestamp.month=${parseInt(dateString.slice(5, 7))} and s.timestamp.day=${parseInt(dateString.slice(8, 10))}
              return distinct p as c
            }
            return c.id
        `,
        {}
    )
    await session.close()
    return result.records.map(x => x.get(0));
}

/**
 * Count all pick up stops in the knowledge graph matching the criteria in the test data (= data in May)
 */
export async function countPickUpsByThresholdInTestData(layer: Layer, metric: String, operator: "<" | "<=" | ">" | ">=" | "=", threshold: Number): Promise<number> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return -1
    }
    console.log(`count pick ups with property ${metric} ${operator} ${threshold} in test data`)
    const result = await session.run(
        `
            MATCH (p:PickUp:${layer})
            where p.${metric} ${operator} ${threshold}
            call {
              with p
              match (p)-[:contains]->(:PickUp:LAYER_1)-[:report]->(r:Report)-[:status]->(s:Status)
              where s.timestamp.year=2023 and s.timestamp.month in [5]
              with {
              year: s.timestamp.year,
                month: s.timestamp.month,
                day: s.timestamp.day} as date
              return distinct date 
            }
            return count(date)
            `,
        {}
    )
    await session.close()
    return result.records[0].get(0);
}

/**
 * Compute and save the scores for all reports in the knowledge graph
 */
export async function computeReportScores(layer: string) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log(`compute report scores`)
    await session.run(
        `
        match (rP:Report:${layer})
        call{
          with rP
          match (rP)-[y:tag]->(t:TrashType)
          return coalesce(sum(y.probability * t.severity), 0) as scoreForMatchedReport, coalesce(sum(t.severity), 0) as scoreForMatchedReportNoProbability
        }
        SET rP.score=scoreForMatchedReport
        SET rP.scoreNoProbability=scoreForMatchedReportNoProbability
        `,
        {}
    )
    await session.close()
}

/**
 * Get occurring dates in a given list of months
 */
export async function getAllOccurringDatesPerMonth(months: string[]): Promise<string[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }

    console.log(`get all occurring dates per months ${months}`)
    const result = await session.run(
        `
            MATCH (s:Status)
            where s.timestamp.year in [${months.map(x => parseInt(x.slice(0, 4)))}] 
            and s.timestamp.month in [${months.map(x => parseInt(x.slice(4, 6)))}]
            RETURN distinct left(toString(s.timestamp), 10) as date
            `,
        {}
    )
    await session.close()
    if (result.records.length === 0) {
        console.log("no dates found")
        return []
    }
    console.log(`found these dates: ${result.records.map(x => x.get(0))}`)
    return result.records.map(x => x.get(0));
}

/**
 * Get all route info nodes for a given layer
 */
export async function getAllOccurringRouteDatesPerLayer(layer: Layer): Promise<string[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }

    console.log(`get all occurring route dates for layer ${layer}`)
    const result = await session.run(
        `
            MATCH (r:RouteInfo:${layer})
            RETURN DISTINCT toString(r.date) as date
            ORDER BY date
            `,
        {}
    )
    await session.close()
    if (result.records.length === 0) {
        console.log("no dates found")
        return []
    }
    console.log(`found these dates: ${result.records.map(x => x.get(0))}`)
    return result.records.map(x => x.get(0));
}

/**
 * Generic node counting query by layer and type
 */
export async function getNumberOf(layer?: Layer, type?: string): Promise<number> {
    const session = driver.session()
    if (!session) {
        console.log("Could not create session")
        return 0
    }
    console.log(`get number of ${type} on layer ${layer}`)
    const result = await session.run(
        `
            MATCH (p${type ? ":" + type : ""}${layer ? ":" + layer : ""})
            return count(p)
            `,
        {}
    )
    await session.close()
    return result.records[0].get(0)
}

/**
 * Get all route info nodes for a given layer
 */
export async function getRouteInfosFromLayer(layer: Layer, day?: string, alpha?: number): Promise<RouteInfo[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log(`get route infos from layer ${layer} on day ${day} for alpha ${alpha}`)
    const result = await session.run(
        `
            MATCH (r:RouteInfo:${layer})
            ${((layer != "LAYER_PREEXISTING" && alpha !== undefined) || day !== undefined) ? "where " : ""}  ${day != undefined ? "r.date=date('" + day + "')" : ""}  ${layer != "LAYER_PREEXISTING" && alpha !== undefined && day !== undefined ? " and " : ""} ${layer != "LAYER_PREEXISTING" && alpha !== undefined ? "r.alpha=" + alpha : ""}
            return r.routeId as routeId, r.routeLength as routeLength, r.routeDuration as routeDuration, r.routeType as routeType, r.date as date, r.stops as stops, r.alpha as alpha, r.maxRouteLength as maxRouteLength, r.maxStopsPerRoute as maxStopsPerRoute, r.pollutionMetric as pollutionMetric, r.cleanWasteThreshold as cleanWasteThreshold, r.probabilityClean as probabilityClean, r.pollutionDistributions as pollutionDistributions
            `,
        {day}
    )
    await session.close()
    return result.records.map(x => ({
        routeId: x.get("routeId"),
        routeLength: x.get("routeLength"),
        routeDuration: x.get("routeDuration"),
        routeType: x.get("routeType"),
        date: x.get("date"),
        stops: x.get("stops"),
        alpha: x.get("alpha"),
        maxRouteLength: x.get("maxRouteLength"),
        maxStopsPerRoute: x.get("maxStopsPerRoute"),
        pollutionMetric: x.get("pollutionMetric"),
        cleanWasteThreshold: x.get("cleanWasteThreshold"),
        probabilityClean: x.get("probabilityClean"),
        pollutionDistributions: x.get("pollutionDistributions")
    }));
}

/**
 * Get all future pick up infos for a given layer
 */
export async function getRouteInfosFromLayerInTestData(layer: Layer, alpha?: number): Promise<RouteInfo[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log(`get route infos in test data from layer ${layer} for alpha ${alpha}`)
    const result = await session.run(
        `
            MATCH (r:RouteInfo:${layer})
            where r.date.month in [5,6] ${layer != "LAYER_PREEXISTING" && alpha !== undefined ? "and r.alpha=" + alpha : ""}
            return r.routeId as routeId, r.routeLength as routeLength, r.routeDuration as routeDuration, r.routeType as routeType, r.date as date, r.stops as stops, r.alpha as alpha, r.maxRouteLength as maxRouteLength, r.maxStopsPerRoute as maxStopsPerRoute, r.pollutionMetric as pollutionMetric, r.cleanWasteThreshold as cleanWasteThreshold
            `,
        {}
    )
    await session.close()
    return result.records.map(x => ({
        routeId: x.get("routeId"),
        routeLength: x.get("routeLength"),
        routeDuration: x.get("routeDuration"),
        routeType: x.get("routeType"),
        date: x.get("date"),
        stops: x.get("stops"),
        alpha: x.get("alpha"),
        maxRouteLength: x.get("maxRouteLength"),
        maxStopsPerRoute: x.get("maxStopsPerRoute"),
        pollutionMetric: x.has("pollutionMetric") ? x.get("pollutionMetric") : "",
        cleanWasteThreshold: x.get("cleanWasteThreshold")
    }));
}

/**
 * Get all clusters for a given layer with the average location
 * @param layer
 */
export async function getClustersWithAverageCoordinates(layer: Layer) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log("get clustered locations means")
    const result = await session.run(
        `
            MATCH (l:Location:${layer})
            return l.cluster_id as cluster, avg(l.lat) as lat, avg(l.lng) as lng, avg(l.altitude) as alt
            order by cluster ASC;
    `, {layer})
    await session.close()
    return result.records.map(x => ({
        clusterId: x.get("cluster"),
        lat: x.get("lat"),
        lng: x.get("lng"),
        alt: x.get("alt")
    }));
}

/**
 * Run the k-means algorithm to cluster locations
 */
export async function kMeans(nClusters: number) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return
    }
    console.log("run k-means with " + nClusters + " clusters")
    const result = await session.run(
        `
    MATCH p=(n:Location)
    WITH project(p) AS subgraph
    CALL kmeans.set_clusters(subgraph, ${nClusters}) YIELD node, cluster_id
    RETURN node.id as node_id, cluster_id
    ORDER BY node_id ASC;
    `)
}

/**
 * Query distance matrix for node set
 */
export async function getDistanceMatrix(layer: Layer, filterNodeIds?: string[], duration = false): Promise<Map<string, Map<string, number>>> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return new Map()
    }
    console.log(`get ${duration ? "duration" : "distance"} matrix for ${filterNodeIds ? filterNodeIds.length : "all"} nodes`)

    const res = await session.run(
        `
        MATCH (source:${layer})-[:location]->(:Location:${layer})-[r:connectsTo]->(:Location:${layer})<-[:location]-(target:${layer})
        ${filterNodeIds ? "WHERE source.id in $filterNodeIds AND target.id in $filterNodeIds" : ""}
        RETURN source.id as sourceId, target.id as targetId, ${duration ? "r.duration" : "r.distance"}  as distance
    `,
        {filterNodeIds}
    )
    await session.close()
    const distanceMatrix: Map<string, Map<string, number>> = new Map()
    res.records.forEach(x => {
        if (!distanceMatrix.has(x.get("sourceId"))) {
            distanceMatrix.set(x.get("sourceId"), new Map())
        }
        const relevantMap = distanceMatrix.get(x.get("sourceId"))
        relevantMap && relevantMap.set(x.get("targetId"), x.get("distance"))
    })
    return distanceMatrix
}

/**
 * Query duration matrix for node set
 */
export async function getDurationMatrix(layer: Layer, filterNodeIds?: string[]): Promise<Map<string, Map<string, number>>> {
    return await getDistanceMatrix(layer, filterNodeIds, true)
}

/**
 * Create route edges between nodes with specified IDs
 */
export async function createRouteEdges(inputLayer: Layer, outputLayer: Layer, routeId: string, edges: [string, string, number?][]) {
    const writeSession = driver.session()
    try {
        const transaction = writeSession.beginTransaction()
        for (let [lastNodeId, newNodeId, numberOfStopInRoute] of edges) {
            transaction.run(
                `
                MATCH (source:${inputLayer})-[lo:location]-(l:Location)-[r:connectsTo]->(l2:Location)-[lo2:location]-(target:${inputLayer})
                WHERE source.id=$lastNodeId AND target.id=$newNodeId
                CREATE (source)-[p:${outputLayer}]->(target)
                ${numberOfStopInRoute != undefined ? "SET p.numberOfStopInRoute=" + numberOfStopInRoute : ""}
                SET p.routeId=$routeId
            `,
                {lastNodeId, newNodeId, routeId}
            )
        }
        await transaction.commit()
    }
    finally {
        await writeSession.close()
    }
}

/**
 * Create route edge between nodes with specified IDs
 */
export async function createRouteEdge(inputLayer: Layer, outputLayer: Layer, routeId: string, lastNodeId: string, newNodeId: string, numberOfStopInRoute?: number) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    await writeSession.run(
        `
        MATCH (source:${inputLayer})-[lo:location]-(l:Location)-[r:connectsTo]->(l2:Location)-[lo2:location]-(target:${inputLayer})
        WHERE source.id=$lastNodeId AND target.id=$newNodeId
        CREATE (source)-[p:${outputLayer}]->(target)
        ${numberOfStopInRoute != undefined ? "SET p.numberOfStopInRoute=" + numberOfStopInRoute : ""}
        SET p.routeId=$routeId
    `,
        {lastNodeId, newNodeId, routeId}
    )
}

/**
 * Return distance between lastNodeId and newNodeId
 */
export async function getDistanceBetweenPickups(inputLayer: Layer, lastNodeId: string, newNodeId: string): Promise<number> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return 0
    }
    const res = await session.run(
        `
        MATCH (source:${inputLayer})-[lo:location]->(l:Location)-[r:connectsTo]->(l2:Location)<-[lo2:location]-(target:${inputLayer})
        WHERE source.id=$lastNodeId AND target.id=$newNodeId
        RETURN r.distance
    `,
        {lastNodeId, newNodeId}
    )
    await session.close()
    if (res.records.length === 0) {
        console.log(`no distance found between ${lastNodeId} and ${newNodeId}`)
    }
    return res.records[0].get(0)
}

/**
 * Return duration between lastNodeId and newNodeId
 */
export async function getDurationBetweenPickups(inputLayer: Layer, lastNodeId: string, newNodeId: string): Promise<number> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return 0
    }
    const res = await session.run(
        `
        MATCH (source:${inputLayer})-[lo:location]->(l:Location)-[r:connectsTo]->(l2:Location)<-[lo2:location]-(target:${inputLayer})
        WHERE source.id=$lastNodeId AND target.id=$newNodeId
        RETURN r.duration
    `,
        {lastNodeId, newNodeId}
    )
    await session.close()
    if (res.records.length === 0) {
        console.log(`no duration found between ${lastNodeId} and ${newNodeId}`)
    }
    return res.records[0].get(0)
}

/**
 * Query routes and return constructed solution info
 */
export async function getSolutionInfosFromLayer(layer: Layer, alpha: number): Promise<SolutionInfo | undefined> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return undefined
    }
    let routeInfos: RouteInfo[] = await getRouteInfosFromLayerInTestData(layer, alpha)
    const solutionInfo: SolutionInfo = {
        routeLength: 0,
        routeDuration: 0,
        stops: 0,
        cleanStops: 0,
        potentialCleanStops: layer === "LAYER_PREEXISTING" ? 0 : (await countPickUpsByThresholdInTestData("LAYER_2", routeInfos[0].pollutionMetric === undefined ? "averageDayScore" : routeInfos[0].pollutionMetric, "<=", routeInfos[0].cleanWasteThreshold || 0))
    }
    await session.close()
    routeInfos.forEach(x => {
            solutionInfo.stops += x.stops
            solutionInfo.cleanStops += x.routeType === "clean" ? x.stops : 0
            solutionInfo.routeLength += x.routeLength
            solutionInfo.routeDuration += x.routeDuration
        }
    )
    solutionInfo.routeLength = Math.round(solutionInfo.routeLength)
    solutionInfo.routeDuration = Math.round(solutionInfo.routeDuration)
    return solutionInfo
}

/**
 * Create route info node
 */
export async function createRouteInfoNode(layer: Layer, routeId: string, routeLength: number, routeDuration: number, dateString: string, routeType: "clean" | "dirty", stops: number, alpha: number, maxRouteLength?: number, maxStopsPerRoute?: number, pollutionMetric?: string, cleanWasteThreshold?: number) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log("create route info node")
    await writeSession.run(
        `
        CREATE (r:RouteInfo:${layer})
        SET r.routeId=$routeId
        SET r.routeLength=$routeLength
        SET r.routeDuration=$routeDuration
        SET r.routeType=$routeType
        SET r.date=date($dateString)
        SET r.stops=$stops
        SET r.alpha=$alpha
        ${pollutionMetric != undefined ? 'SET r.pollutionMetric="' + pollutionMetric + '"' : ''}
        ${cleanWasteThreshold != undefined ? 'SET r.cleanWasteThreshold=' + cleanWasteThreshold : ''}
        ${maxRouteLength != undefined ? 'SET r.maxRouteLength=' + maxRouteLength : ''}
        ${maxStopsPerRoute != undefined ? 'SET r.maxStopsPerRoute=' + maxStopsPerRoute : ''}
    `,
        {routeId, routeLength, routeType, dateString, stops, alpha, routeDuration}
    )
}

/**
 * Generic property getter for pick up stops
 */
export async function getPropertyOfPickUps(pickupStops: string[], propertyName: string): Promise<Map<string, any>> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return new Map()
    }
    console.log(`get property ${propertyName} of pick ups`)
    const result = await session.run(
        `
        MATCH (p:PickUp:LAYER_2)
        WHERE p.id in $pickupStops
        RETURN p.id, p.${propertyName}
    `,
        {pickupStops}
    )
    await session.close()
    const resultMap: Map<string, NormalDistribution | StudentTDistribution | NormalMixture> = new Map()
    result.records.forEach(x => {
        resultMap.set(x.get(0), x.get(1))
    });
    return resultMap
}

/**
 * Get pollution model of pick up stops (normal distribution)
 */
export async function getNormalDistributionOfPickUps(pickupStops: string[], propertyName: string): Promise<Map<string, NormalDistribution>> {
    return getPropertyOfPickUps(pickupStops, propertyName)
}

/**
 * Get pollution model of pick up stops (normal mixture)
 */
export async function getNormalMixtureOfPickUps(pickupStops: string[], propertyName: string): Promise<Map<string, NormalMixture>> {
    return getPropertyOfPickUps(pickupStops, propertyName)
}

/**
 * Get pollution model of pick up stops (student t distribution)
 */
export async function getStudentTDistributionOfPickUps(pickupStops: string[], propertyName: string): Promise<Map<string, StudentTDistribution>> {
    return getPropertyOfPickUps(pickupStops, propertyName)
}

/**
 * Update route info node
 */
export async function updateRoute(algorithmLayer: Layer, pickupLayer: Layer, routeInfo: RouteInfo, route: string[], strategy: "classification" | "stochastic", simulatedAnnealingEnabled: boolean, probabilityPropertyName?: string, pollutionThreshold?: number) {
    console.log(`update route in layer ${algorithmLayer}`)
    const customWriteSession = driver.session()
    try {
        if (!customWriteSession) {
            console.log("Neo4j session not connected during write attempt")
            return
        }
        console.log(`parameters: ${routeInfo.routeId}, ${routeInfo.routeLength}, ${routeInfo.routeType}, ${routeInfo.date}, ${routeInfo.stops}, ${routeInfo.alpha}, ${routeInfo.probabilityClean}, ${strategy}, ${probabilityPropertyName}, ${pollutionThreshold}`)
        await customWriteSession.run(
            `
            MATCH (r:RouteInfo:${algorithmLayer} {routeId: $routeId})
            DELETE r
        `,
            {
                routeId: routeInfo.routeId,
                routeLength: routeInfo.routeLength,
                routeDuration: routeInfo.routeDuration,
                routeType: routeInfo.routeType,
                dateString: routeInfo.date,
                stops: routeInfo.stops
            }
        )
        await customWriteSession.run(
            `
            MATCH (:${pickupLayer})-[r:${algorithmLayer} {routeId: $routeId}]->(:${pickupLayer})
            DELETE r
        `,
            {
                routeId: routeInfo.routeId
            }
        )
        await customWriteSession.run(
            `
            CREATE (r:RouteInfo:${algorithmLayer})
            SET r.routeId=$routeId, r.routeLength=$routeLength, r.routeDuration=$routeDuration, r.routeType=$routeType, r.date=date($dateString), r.stops=$stops, r.alpha=$alpha
            ${routeInfo.pollutionMetric != undefined ? 'SET r.pollutionMetric="' + routeInfo.pollutionMetric + '"' : ''}
            ${routeInfo.cleanWasteThreshold != undefined ? 'SET r.cleanWasteThreshold=' + routeInfo.cleanWasteThreshold : ''}
            ${routeInfo.maxRouteLength != undefined ? 'SET r.maxRouteLength=' + routeInfo.maxRouteLength : ''}
            ${routeInfo.maxStopsPerRoute != undefined ? 'SET r.maxStopsPerRoute=' + routeInfo.maxStopsPerRoute : ''}
            SET r.simulatedAnnealingEnabled=$simulatedAnnealingEnabled
        `,
            {
                routeId: routeInfo.routeId,
                routeLength: routeInfo.routeLength,
                routeDuration: routeInfo.routeDuration,
                routeType: routeInfo.routeType,
                dateString: routeInfo.date.toString(),
                stops: routeInfo.stops,
                alpha: routeInfo.alpha,
                maxRouteLength: routeInfo.maxRouteLength,
                maxStopsPerRoute: routeInfo.maxStopsPerRoute,
                simulatedAnnealingEnabled: simulatedAnnealingEnabled
            }
        )
        for (let i = 0; i < route.length - 1; i++) {
            await customWriteSession.run(`MATCH (source:${pickupLayer}) WHERE source.id="${route[i]}"
                      MATCH (target:${pickupLayer}) WHERE target.id="${route[i + 1]}"
                      CREATE (source)-[r:${algorithmLayer}]->(target)
                      SET r.routeId="${routeInfo.routeId}", r.numberOfStopInRoute=${i}`, {});
        }
        if (probabilityPropertyName && pollutionThreshold) {
            let probClean = routeInfo.probabilityClean
            const distributions = (await customWriteSession.run(`
                    MATCH (source:PickUp:${pickupLayer}) 
                    WHERE source.id in ['${route.join("','")}']
                    return collect(source.${probabilityPropertyName}.dist) as distributions
                    `, {})).records[0].get(0)
            if (!routeInfo.probabilityClean) {
                if (probabilityPropertyName === "normal_prob" || probabilityPropertyName === "bayesian_prob") {
                    probClean = convProb(distributions, pollutionThreshold)
                } else if (probabilityPropertyName === "bayesian_prob_mixed" || probabilityPropertyName === "t_prob") {
                    probClean = convProbFFT(distributions, pollutionThreshold)
                }
            }
            console.log(`update route with probability clean ${probClean}`)

            await customWriteSession.run(`
                MATCH (r:RouteInfo:${algorithmLayer})
                WHERE r.routeId=$routeId
                SET r.probabilityPropertyName=$probabilityPropertyName
                SET r.probabilityClean=$probClean
                SET r.pollutionDistributions=$distributions
                `, {routeId: routeInfo.routeId, probClean, distributions, probabilityPropertyName})
        }
        console.log("route updated")
    } finally {
        await customWriteSession.close()
    }
    return
}

/**
 * Query cluster id by location id
 */
export async function getClusterIdByLocationId(layer: Layer, locationId: string) {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return ""
    }
    console.log(`get cluster id by location id ${locationId}`)
    const result = await session.run(
        `
        MATCH (l:Location:${layer}) 
        WHERE l.id=$locationId
        RETURN l.cluster_id
        `,
        {locationId}
    )
    await session.close()
    return result.records[0].get(0)
}

/**
 * Construct layer for plug-and-play memgraph visualization
 */
export async function createVisualization(inputLayer: Layer, solutionLayer: Layer, outputLayer: Layer) {
    if (!writeSession) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log("create visualization layer")
    await writeSession.run(`
MATCH (p1:${inputLayer})-[:location]-(l1:Location:${inputLayer})-[:connectsTo]->(l2:Location:${inputLayer})-[:location]-(p2:${inputLayer})
CALL {
  WITH p1, p2, l1, l2
  MATCH (p1)-[oPath:${solutionLayer}]->(p2)
  CREATE (l1)-[path:${outputLayer}]->(l2)
  SET path.routeId = oPath.routeId
  SET path.numberOfStopInRoute = oPath.numberOfStopInRoute
  RETURN path
}
RETURN path, l1, l2`,
        {}
    )
}

/**
 * Query route info by route id
 */
export async function getRouteByRouteInfo(layer: Layer, routeInfo: RouteInfo): Promise<{
    id: string,
    lat: number,
    lng: number,
    score: null | number
}[]> {
    const route: {
        id: string,
        lat: number,
        lng: number,
        score: null | number
    }[] = []
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    const result = await session.run(
        `
        MATCH (n:LAYER_2)-[r:${layer} {routeId: $routeId}]->(n2:LAYER_2)
        CALL {
            WITH n
            MATCH (n)-[:location]->(l:Location:LAYER_2)
            RETURN l.lat as lat1, l.lng as lng1
        }
        CALL {
            WITH n2
            MATCH (n2)-[:location]->(l:Location:LAYER_2)
            RETURN l.lat as lat, l.lng as lng
        }
        
        return n.id as nodeId1, n2.id as nodeId, lat1, lng1, lat, lng, n2.averageDayScore as dscoreOfNode2, r.numberOfStopInRoute as numberOfStopInRoute
        ORDER BY numberOfStopInRoute
        `,
        {routeId: routeInfo.routeId}
    )

    result.records.map(x => (x.get("numberOfStopInRoute") == 0 ? [
        {
            id: x.get("nodeId1"),
            lat: x.get("lat1"),
            lng: x.get("lng1"),
            score: null
        },
        {
            id: x.get("nodeId"),
            lat: x.get("lat"),
            lng: x.get("lng"),
            score: x.get("dscoreOfNode2")
        }] : [
        {
            id: x.get("nodeId"),
            lat: x.get("lat"),
            lng: x.get("lng"),
            score: x.get("dscoreOfNode2")
        }]).forEach(x => route.push(x)))
    await session.close()
    return route
}

/**
 *  Get detailed information about a tour stop (i.e., pick up stop) by id
 */
export async function getPickUpInfoById(id: string): Promise<PickUpInfo[]> {
    const session = driver.session()
    if (!session) {
        console.log("Neo4j session not connected during write attempt")
        return []
    }
    console.log(`get pick up info by id`)
    const result = await session.run(
        `
        MATCH (p:PickUp:LAYER_2)
        WHERE p.id=$id
        call {
          with p
          match (p)-[:contains]->(p1:PickUp:LAYER_1)-[:report]->(rP:Report)-[:status]-(sP:Status)
          where sP.timestamp.month IN [1,2,3,4]
          call {
            with rP
            call {
                with rP
                match (t:TrashType)
                WHERE EXISTS (
                    (rP)-[:tag]->(t)
                ) and not (t.label = "math_count") and not (t.label = "image_noise")
                call {
                  with t, rP
                  match (rP)-[y:tag]->(t)
                  with {
                    type: t.label,
                    count: count(y)
                  } as TrashCount
                  return TrashCount
                }
                return collect(TrashCount) as Trash
            }
            with { rid: rP.id,
                   timestamp: sP.timestamp,
                   rscore: rP.score,
                   trash: coalesce(Trash, [])
            } as Report
            return Report
          }
          with { 
              year: sP.timestamp.year,
              month: sP.timestamp.month,
              day: sP.timestamp.day,
              reports: collect(Report),
              dscore: avg(Report.rscore)
            } AS Day
          
          order by Day.year, Day.month, Day.day
          return Day
        }
        return Day
        `,
        {id}
    )

    await session.close()
    return result.records
        .map(x => x.get("Day"))
        .filter((x: PickUpInfo) => x.day)
        .map((x: PickUpInfo) => ({
            year: x.year,
            month: x.month,
            day: x.day,
            dscore: x.dscore,
            reports: x.reports.map(y => ({
                rid: y.rid,
                rscore: y.rscore,
                timestamp: y.timestamp,
                trash: y.trash.map(z => ({
                    type: z.type,
                    count: z.count
                }))
            }))
        }));
}