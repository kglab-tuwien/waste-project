/**
 * This file is used to create the knowledge graph layers from the mongoDB database.
 */
import * as mongoDB from 'mongodb'
import {createKgLayer1} from "./kg-layer-1";
import {createKgLayer2} from "./kg-layer-2";
import {dropAll, dropAllExcept, dropLayer} from "./neo4j-service";
import {extractRoutes} from "./kg-layer-preexisting";

let dbConnString = process.env['DB_CONN_STRING'] || ""
console.log(`Trying to connect to mongoDB at ${dbConnString}`)
const client: mongoDB.MongoClient = new mongoDB.MongoClient(dbConnString)
console.log(`Mongo connected successfully`)

export async function createLayer1(days: number | undefined) {
    const db: mongoDB.Db = client.db(process.env.DB_NAME)
    console.log(`Connected to database: ${db.databaseName}`)
    const collectionsList = await db.collections()
    let collectionNameList = collectionsList.map((c) => c.collectionName)
    days && (collectionNameList = collectionNameList.slice(0, days));
    console.log(collectionNameList)
    console.log("drop all")
    await dropAll()
    console.log("Creating Layer 1")
    await createKgLayer1(collectionNameList, db)
    console.log("Finished creating Layer 1");
}

export async function createLayer2(withDistances: boolean | undefined) {
    const db: mongoDB.Db = client.db(process.env.DB_NAME)
    console.log(`Connected to database: ${db.databaseName}`)
    console.log("drop all layers above and including LAYER_2")
    await dropAllExcept(["LAYER_1"])
    console.log("Creating Layer 2" + (withDistances ? " with distances" : ""))
    await createKgLayer2(withDistances)
    console.log("Finished creating Layer 2");
}

export async function createLayerPreexisting(days: number | undefined) {
    const db: mongoDB.Db = client.db(process.env.DB_NAME)
    console.log(`Connected to database: ${db.databaseName}`)
    const collectionsList = await db.collections()
    let collectionNameList = collectionsList.map((c) => c.collectionName)
    days && (collectionNameList = collectionNameList.slice(0, days));
    console.log("drop LAYER_PREEXISTING, LAYER_VISUAL")
    await dropLayer("LAYER_PREEXISTING")
    await dropLayer("LAYER_VISUAL")
    console.log("Creating LAYER_PREEXISTING")
    await extractRoutes(collectionNameList, db)
    console.log("Finished creating LAYER_PREEXISTING");
}
