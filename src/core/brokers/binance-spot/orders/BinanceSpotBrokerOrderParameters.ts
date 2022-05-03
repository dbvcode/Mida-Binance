import { MidaBrokerOrderParameters } from "@reiryoku/mida";
import { Binance } from "binance-api-node";

export type BinanceSpotBrokerOrderParameters = MidaBrokerOrderParameters & {
    binanceHandler: Binance;
};
