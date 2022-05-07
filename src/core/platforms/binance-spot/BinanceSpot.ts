import createBinanceConnection from "binance-api-node";
import {
    MidaDate,
    MidaTradingAccountOperativity,
    MidaTradingAccountPositionAccounting,
    MidaTradingPlatform,
} from "@reiryoku/mida";
import { BinanceSpotLoginParameters } from "#platforms/binance-spot/BinanceSpotLoginParameters";
import { BinanceSpotAccount } from "#platforms/binance-spot/BinanceSpotAccount";

const PLATFORM_NAME: string = "Binance Spot";
const PLATFORM_SITE_URI: string = "https://www.binance.com";
const PLATFORM_PRIMARY_ASSET: string = "BTC";

export class BinanceSpot extends MidaTradingPlatform {
    public constructor () {
        super({ name: PLATFORM_NAME, siteUri: PLATFORM_SITE_URI, });
    }

    public override async login ({ apiKey, apiSecret, }: BinanceSpotLoginParameters): Promise<BinanceSpotAccount> {
        return new BinanceSpotAccount({
            id: "",
            platform: this,
            creationDate: new MidaDate(0),
            primaryAsset: PLATFORM_PRIMARY_ASSET,
            indicativeLeverage: 0,
            operativity: MidaTradingAccountOperativity.REAL,
            ownerName: "",
            positionAccounting: MidaTradingAccountPositionAccounting.NETTED,
            binanceConnection: createBinanceConnection({ apiKey, apiSecret, }),
        });
    }
}
