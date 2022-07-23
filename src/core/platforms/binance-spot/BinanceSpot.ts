/*
 * Copyright Reiryoku Technologies and its contributors, www.reiryoku.com, www.mida.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

import {
    date,
    decimal,
    MidaTradingAccountOperativity,
    MidaTradingAccountPositionAccounting,
    MidaTradingPlatform,
} from "@reiryoku/mida";
import createBinanceConnection from "binance-api-node";
import { BinanceSpotLoginParameters, } from "#platforms/binance-spot/BinanceSpotLoginParameters";
import { BinanceSpotAccount, } from "#platforms/binance-spot/BinanceSpotAccount";

export const PLATFORM_NAME: string = "Binance Spot";
export const PLATFORM_SITE_URI: string = "https://www.binance.com";
export const PLATFORM_PRIMARY_ASSET: string = "USDT";

export class BinanceSpot extends MidaTradingPlatform {
    public constructor () {
        super({ name: PLATFORM_NAME, siteUri: PLATFORM_SITE_URI, });
    }

    public override async login ({ apiKey, apiSecret, }: BinanceSpotLoginParameters): Promise<BinanceSpotAccount> {
        const tradingAccount: BinanceSpotAccount = new BinanceSpotAccount({
            id: "",
            platform: this,
            creationDate: date(0),
            primaryAsset: PLATFORM_PRIMARY_ASSET,
            indicativeLeverage: decimal(0),
            operativity: MidaTradingAccountOperativity.REAL,
            ownerName: "",
            positionAccounting: MidaTradingAccountPositionAccounting.NETTED,
            binanceConnection: createBinanceConnection({ apiKey, apiSecret, }),
        });

        await tradingAccount.preload();

        return tradingAccount;
    }
}
