import { MidaTrade, MidaTradeParameters } from "@reiryoku/mida";

export class BinanceSpotTrade extends MidaTrade {
    public constructor (parameters: MidaTradeParameters) {
        super(parameters);
    }
}
