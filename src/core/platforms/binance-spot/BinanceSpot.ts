import {
    MidaDate,
    MidaTradingAccountOperativity,
    MidaTradingAccountPositionAccounting,
    MidaTradingPlatform,
} from "@reiryoku/mida";
import createBinanceConnection from "binance-api-node";
import { BinanceSpotLoginParameters } from "#platforms/binance-spot/BinanceSpotLoginParameters";
import { BinanceSpotAccount } from "#platforms/binance-spot/BinanceSpotAccount";

export const PLATFORM_NAME: string = "Binance Spot";
export const PLATFORM_SITE_URI: string = "https://www.binance.com";
export const PLATFORM_PRIMARY_ASSET: string = "BTC";

export class BinanceSpot extends MidaTradingPlatform {
    public constructor () {
        super({ name: PLATFORM_NAME, siteUri: PLATFORM_SITE_URI, });
    }

    public override async login ({ apiKey, apiSecret, }: BinanceSpotLoginParameters): Promise<BinanceSpotAccount> {
        const tradingAccount: BinanceSpotAccount = new BinanceSpotAccount({
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

        await tradingAccount.preload();

        return tradingAccount;
    }
}
