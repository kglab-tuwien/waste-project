/**
 * Main entry point of the application, defines the REST API endpoints
 */
import express, {Express, Request, Response} from "express";
import cors from 'cors';
import {createLayer1, createLayer2, createLayerPreexisting} from "./db/mongo-service";
import {
    connectKG,
    createVisualization,
    disconnectKG,
    dropDistances,
    dropLayer,
    getAllOccurringDatesPerMonth,
    getAllOccurringRouteDatesPerLayer,
    getBase,
    getDropOff,
    getLocationByNodeId,
    getNumberOf,
    getPickUpInfoById,
    getRouteByRouteInfo,
    getRouteInfosFromLayer,
    getSolutionInfosFromLayer,
    sessionInUse
} from "./db/neo4j-service";
import {greedySolve} from "./db/algorithms/greedy";
import {Layer} from "./db/layer";
import {createDistances} from "./db/kg-distances";
import {localSearch} from "./db/algorithms/localsearch";
import {performance} from 'perf_hooks';

const app: Express = express();

// no CORS
app.use(cors())

app.get("/", (req: Request, res: Response) => {
    res.status(200).json("Server is up and running");
});

app.param("layer", (req, res, next, layer) => {
    console.log(`called with layer ${layer}`)
    next()
})

type CreateReqParams = { layer?: Layer }
type CreateReqBody = { layer?: string }
type ReqQuery = {
    days?: number,
    withDistances?: boolean,
    maxIteration?: number,
    strategy: "classification" | "stochastic"
}
type ResBody = { foo3?: string }

type CreateRequest = Request<CreateReqParams, ResBody, CreateReqBody, ReqQuery>

/**
 * Layer creation endpoint
 *
 * @param layer layer of the KG to create
 * @param days limit data to a fixed number of days, undefined for all
 */
app.post("/create/:layer", async (req: CreateRequest, res: Response) => {
    console.log(`Request to /create/${req.params.layer}?days=${req.query.days}?withDistances=${req.query.withDistances}`)
    const alphas = [33786, 0, 250, 500, 750, 1000, 1500, 2179, 4358, 6538, 999999]
    if (sessionInUse()) {
        res.status(500)
        res.statusMessage = "KG session currently in use, try later"
        res.end()
        return
    }
    await disconnectKG()
    await connectKG()
    res.end()
    if (req.params.layer == "LAYER_1") {
        await createLayer1(req.query.days)
    } else if (req.params.layer == "LAYER_2") {
        await createLayer2(req.query.withDistances)
    } else if (req.params.layer == "LAYER_PREEXISTING") {
        await createLayerPreexisting(req.query.days)
    } else if (req.params.layer == "LAYER_GREEDY") {
        // average CO2 equivalent (CO2e) emissions estimate: 2846g/km
        // average CO2e emissions per kg on unrecycled (landfilled) organic waste: 0.619g/kg
        // average kg of organic waste per bin: 30kg (rough estimate based on 120l bin)
        // --> 18.57kg CO2e emissions per bin
        // --> 6538m distance per bin justifiable by CO2e emissions
        // 0, 2179, 4358, 6538, 999999
        const predictionDays = await getAllOccurringDatesPerMonth(["202305", "202306"])
        await dropLayer("LAYER_GREEDY");
        await dropLayer("LAYER_VISUAL");

        for (let alpha of alphas) {
            console.log(`greedy for alpha ${alpha}`)
            const startTime = performance.now()
            for (let day of predictionDays) {
                console.log(`greedy for alpha ${alpha} and day ${day}`)
                await greedySolve(alpha, "averageDayScore", 0.103, 1, day, false, 500000)
            }
            const endTime = performance.now()
            console.log(`greedy for alpha ${alpha} took ${endTime - startTime} milliseconds`)
        }
        await createVisualization("LAYER_2", "LAYER_GREEDY", "LAYER_VISUAL")
    } else if (req.params.layer == "LAYER_LS") {
        const predictionDays = await getAllOccurringDatesPerMonth(["202305", "202306"])
        await dropLayer("LAYER_VISUAL");
        for (let probabilityName of (req.query.strategy == "classification" ? [undefined] : ["bayesian_prob"])) {
            const algorithmLayer = <"LAYER_LS_STOCHASTIC" | "LAYER_LS_CLASSIFICATION" | "LAYER_LS_STOCHASTIC_NORMAL_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB" | "LAYER_LS_STOCHASTIC_BAYESIAN_PROB_MIXED" | "LAYER_LS_STOCHASTIC_T_PROB">("LAYER_LS_" + req.query.strategy.toUpperCase() + (probabilityName !== undefined ? "_" + probabilityName.toUpperCase() : ""))
            await dropLayer(algorithmLayer);
            for (let alpha of alphas) {
                console.log(`LS for alpha ${alpha} with ${req.query.strategy} strategy and ${probabilityName} probability`)
                const startTime = performance.now()
                for (let day of predictionDays) {
                    console.log(`local search for day ${day} and alpha ${alpha} with ${req.query.strategy} strategy`)
                    // SA enabled
                    //await localSearch(req.query.maxIteration || 100, "LAYER_GREEDY", alpha, "averageDayScore", 0.103, 1, day,
                    //    req.query.strategy, true, probabilityName)
                    // SA disabled
                    await localSearch(algorithmLayer, req.query.maxIteration || 200, "LAYER_GREEDY", alpha, "averageDayScore", 0.103, 1, day,
                        req.query.strategy, true, probabilityName)
                }
                const endTime = performance.now()
                console.log(`local search with ${req.query.strategy} strategy for alpha ${alpha} took ${endTime - startTime} milliseconds`)
            }
        }
        console.log(`optimized ${predictionDays.length} days with ${alphas.length} configurations each`)
        console.log("creating visualization")
        //await createVisualization("LAYER_2", "LAYER_LS", "LAYER_VISUAL")
    }
    await disconnectKG()
});

type DistancesReqQuery = { reset?: string }

type CreateDistancesRequest = Request<CreateReqParams, ResBody, CreateReqBody, DistancesReqQuery>

/**
 * create distances endpoint: create the distances between all nodes of a given layer
 *
 * @param layer layer of the KG to create
 */
app.post("/create/distances/:layer", async (req: CreateDistancesRequest, res: Response) => {
    console.log(`Request to /create/distances/${req.params.layer}`)
    if (sessionInUse()) {
        res.status(500)
        res.statusMessage = "KG session currently in use, try later"
        res.end()
        return
    }
    await connectKG()
    res.end()
    if (req.query.reset == "true") {
        req.params.layer && await dropDistances(req.params.layer)
    }
    req.params.layer && await createDistances(req.params.layer)
    await disconnectKG()
});

type CountReqQuery = { layer?: Layer, nodeLabel?: string }
type CountResBody = { foo3?: string }

type CountRequest = Request<{}, CountResBody, {}, CountReqQuery>

/**
 * count endpoint: count the number of nodes in the KG for a given layer and node label
 *
 * @param layer layer filter
 * @param nodeLabel node label filter
 */
app.get("/count", async (req: CountRequest, res: Response) => {
    console.log(`Request to /count?layer=${req.query.layer},nodeLabel=${req.query.nodeLabel}`)
    const count = await getNumberOf(req.query.layer, req.query.nodeLabel)
    res.send({count: count});
    res.end()
});


type StaticRequest = Request<{}, CountResBody, {}, CountReqQuery>

/**
 * get all static points on the map
 */
app.get("/static", async (req: StaticRequest, res: Response) => {
    console.log(`Request to /static`)
    const base = await getBase("LAYER_2")
    const baseLocation = await getLocationByNodeId("LAYER_2", base)
    const dropOff = await getDropOff("LAYER_2")
    const dropOffLocation = await getLocationByNodeId("LAYER_2", dropOff)

    res.send({base: baseLocation, dropOff: dropOffLocation});
    res.end()
});

type DaysReqQuery = { layer: Layer }
type DaysRequest = Request<{}, CountResBody, {}, DaysReqQuery>

/**
 * days endpoint: get all days with predictions for a given layer
 */
app.get("/days", async (req: DaysRequest, res: Response) => {
    console.log(`Request to /days`)
    const predictionDays = await getAllOccurringRouteDatesPerLayer(req.query.layer)

    res.send({days: predictionDays});
    res.end()
});


type RoutesQuery = { layer: Layer, day: string, alpha: number }
type RoutesResBody = { routes?: object }

type RoutesRequest = Request<{}, RoutesResBody, {}, RoutesQuery>

/**
 * Routes endpoint: get all routes for a given layer, day and alpha
 */
app.get("/routes", async (req: RoutesRequest, res: Response) => {
    console.log(`Request to /routes/layer=${req.query.layer}&day=${req.query.day}&alpha=${req.query.alpha}`)
    const routeInfos = await getRouteInfosFromLayer(req.query.layer, req.query.day, req.query.alpha)
    console.log(routeInfos)
    const routes = []

    for (let routeInfo of routeInfos) {
        const route = (await getRouteByRouteInfo(req.query.layer, routeInfo))
        routeInfo.score = route.map(x => x.score || 0).reduce((a, b) => a + b, 0) / routeInfo.stops
        routes.push({
            routeInfo: routeInfo,
            routeCoords: route
        })
    }
    res.send({routes: routes});
    console.log(`found ${routes.length} routes`)
    res.end()
});

type SolutionQuery = { layer: Layer, alpha: number }
type SolutionResBody = {
    routeLength: number,
    routeDuration: number,
    stops: number,
    cleanStops: number,
    potentialCleanStops: number,
    runtime: number
}

type SolutionRequest = Request<{}, SolutionResBody, {}, SolutionQuery>


/**
 * Solution endpoint: get the solution for a given layer and alpha
 */
app.get("/solution", async (req: SolutionRequest, res: Response) => {
    console.log(`Request to /solution/layer=${req.query.layer}&alpha=${req.query.alpha}`)
    const solutionInfos = await getSolutionInfosFromLayer(req.query.layer, req.query.alpha)
    console.log(solutionInfos)
    res.send(solutionInfos);
    res.end()
});

type PickUpQuery = { id: string }
type PickUpResBody = { pickUpObject?: object }

type PickUpRequest = Request<{}, PickUpResBody, {}, PickUpQuery>

/**
 * PickUp endpoint: get the pick up info for a given pickup id
 */
app.get("/pickup", async (req: PickUpRequest, res: Response) => {
    console.log(`Request to /pickup?id=${req.query.id}`)
    res.send(await getPickUpInfoById(req.query.id));
    res.end()
});

app.listen(4000, async () => {
    console.log(`App is listening on port 4000`);
});