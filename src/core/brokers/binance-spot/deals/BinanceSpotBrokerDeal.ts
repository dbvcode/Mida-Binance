import { MidaBrokerDeal, MidaBrokerDealParameters } from "@reiryoku/mida";

export class BinanceSpotBrokerDeal extends MidaBrokerDeal {
    public constructor (parameters: MidaBrokerDealParameters) {
        super(parameters);
    }
}
