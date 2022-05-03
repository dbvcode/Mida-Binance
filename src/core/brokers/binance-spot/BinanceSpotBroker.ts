import createBinanceConnection from "binance-api-node";
import {
    MidaBroker,
    MidaBrokerAccountOperativity,
    MidaBrokerAccountPositionAccounting,
    MidaDate,
} from "@reiryoku/mida";
import { BinanceSpotBrokerLoginParameters } from "#brokers/binance-spot/BinanceSpotBrokerLoginParameters";
import { BinanceSpotBrokerAccount } from "#brokers/binance-spot/BinanceSpotBrokerAccount";

const BROKER_NAME: string = "Binance Spot";
const BROKER_WEBSITE_URI: string = "https://www.binance.com";
const BROKER_DEPOSIT_ASSET: string = "BTC";

export class BinanceSpotBroker extends MidaBroker {
    public constructor () {
        super({ name: BROKER_NAME, websiteUri: BROKER_WEBSITE_URI, });
    }

    public override async login ({ apiKey, apiSecret, }: BinanceSpotBrokerLoginParameters): Promise<BinanceSpotBrokerAccount> {
        return new BinanceSpotBrokerAccount({
            id: "",
            broker: this,
            creationDate: new MidaDate(),
            depositAsset: BROKER_DEPOSIT_ASSET,
            indicativeLeverage: 0,
            operativity: MidaBrokerAccountOperativity.REAL,
            ownerName: "",
            positionAccounting: MidaBrokerAccountPositionAccounting.NETTED,
            binanceConnection: createBinanceConnection({ apiKey, apiSecret, }),
        });
    }
}
