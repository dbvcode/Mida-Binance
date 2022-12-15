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

import { MidaPlugin, MidaPluginActions, } from "@reiryoku/mida";
import { BinanceSpot, } from "#platforms/binance-spot/BinanceSpot";

export const pluginId: string = "2ae5e8d1-1101-4b9c-b6e1-e44497bb2803";
export const pluginVersion: string = "2.1.1";

export class BinancePlugin extends MidaPlugin {
    public constructor () {
        super({
            id: pluginId,
            name: "Mida Binance",
            version: pluginVersion,
            description: "A Mida plugin for using Binance",
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addPlatform("Binance/Spot", new BinanceSpot());
    }
}
