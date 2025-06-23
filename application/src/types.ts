/**
 * This file contains all the types used in the project
 */
export type LocationAndIdentifier = {
    id?: string,
    latitude: number,
    longitude: number,
    altitude?: number
}

export type RoutingResponse = {
    distance: number,
    duration: number
}

export type NormalDistribution = {
    mu: number,
    sigma: number
}
export type StudentTDistribution = {
    mu: number,
    sigma: number,
    n: number
}
export type NormalMixture = {
    mu1: number,
    sigma1: number,
    mu2: number,
    sigma2: number,
    mu3: number,
    sigma3: number,
    weights: number[]
}

export type RouteInfo = {
    routeId: string,
    routeLength: number,
    routeDuration: number,
    routeType: "clean" | "dirty",
    stops: number,
    date: {
        year: number,
        month: number,
        day: number
    },
    alpha: number,
    score?: number,
    probabilityClean?: number,
    pollutionDistributions?: NormalDistribution[] | StudentTDistribution[] | NormalMixture[],
    maxRouteLength?: number,
    maxStopsPerRoute?: number,
    pollutionMetric?: string,
    cleanWasteThreshold?: number
}

export type SolutionInfo = {
    routeLength: number,
    routeDuration: number,
    stops: number,
    cleanStops: number,
    potentialCleanStops: number
}

export type PickUpCount = {
    id: String,
    values: number[]
}

export type PickUpCandidate = {
    id: string,
    distance: number,
    sourceIndex?: number,
    targetIndex?: number
}

export type PickUpInfo = {
    year: number,
    month: number,
    day: number,
    dscore: number,
    reports: {
        rid: number,
        rscore: number,
        timestamp: {
            year: number,
            month: number,
            day: number,
            hour: number,
            minute: number,
            second: number,
            nanosecond: number
        }
        trash: {
            type: string,
            count: number
        }[]
    }[]
}