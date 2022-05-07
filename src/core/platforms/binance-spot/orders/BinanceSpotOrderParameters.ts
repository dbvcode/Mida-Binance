import { MidaEmitter, MidaOrderParameters } from "@reiryoku/mida";
import { Binance } from "binance-api-node";

export type BinanceSpotOrderParameters = MidaOrderParameters & {
    binanceConnection: Binance;
    binanceEmitter: MidaEmitter;
};
