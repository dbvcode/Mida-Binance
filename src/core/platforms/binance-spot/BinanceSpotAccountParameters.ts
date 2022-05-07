import { MidaTradingAccountParameters } from "@reiryoku/mida";
import { Binance } from "binance-api-node";

export type BinanceSpotAccountParameters = MidaTradingAccountParameters & {
    binanceConnection: Binance;
};
