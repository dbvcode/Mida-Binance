import {
    MidaEmitter,
    MidaOrderDirectives,
    MidaOrderParameters,
} from "@reiryoku/mida";
import { Binance } from "binance-api-node";

export type BinanceSpotOrderParameters = MidaOrderParameters & {
    directives?: MidaOrderDirectives;
    binanceConnection: Binance;
    binanceEmitter: MidaEmitter;
};
