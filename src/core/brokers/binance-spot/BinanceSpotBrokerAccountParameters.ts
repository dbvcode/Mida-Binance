import { GenericObject, MidaBrokerAccountParameters } from "@reiryoku/mida";
import { Binance } from "binance-api-node";

export type BinanceSpotBrokerAccountParameters = MidaBrokerAccountParameters & {
    binanceConnection: Binance;
};
