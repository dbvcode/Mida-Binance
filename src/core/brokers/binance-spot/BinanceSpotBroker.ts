import Binance from "binance-api-node";
import {
    GenericObject,
    MidaBroker,
    MidaBrokerAccountOperativity,
    MidaBrokerAccountPositionAccounting,
    MidaDate,
} from "@reiryoku/mida";
import { BinanceSpotBrokerLoginParameters } from "#brokers/binance-spot/BinanceSpotBrokerLoginParameters";
import { BinanceSpotBrokerAccount } from "#brokers/binance-spot/BinanceSpotBrokerAccount";

export class BinanceSpotBroker extends MidaBroker {
    public constructor () {
        super({
            name: "Binance Spot",
            websiteUri: "https://www.binance.com",
        });
    }

    // @ts-ignore
    public override async login ({
        apiKey,
        apiSecret,
    }: BinanceSpotBrokerLoginParameters): Promise<BinanceSpotBrokerAccount> {
        const binanceHandler: GenericObject = Binance({
            apiKey,
            apiSecret,
        });

        const balances: GenericObject = await binanceHandler.balance();
        let depositAsset: string = Object.keys(balances)[0];

        if (balances["USD"]) {
            depositAsset = "USD";
        }
        else if (balances["EUR"]) {
            depositAsset = "EUR";
        }
        else if (balances["BTC"]) {
            depositAsset = "BTC";
        }

        return new BinanceSpotBrokerAccount({
            id: "",
            // @ts-ignore
            broker: this,
            creationDate: new MidaDate(),
            depositCurrencyDigits: -1,
            depositCurrencyIso: depositAsset,
            indicativeLeverage: 0,
            operativity: MidaBrokerAccountOperativity.REAL,
            ownerName: "",
            positionAccounting: MidaBrokerAccountPositionAccounting.NETTED,
            binanceHandler,
        });
    }
}
