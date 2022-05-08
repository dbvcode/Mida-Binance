import { MidaPlugin, MidaPluginActions } from "@reiryoku/mida";
import { BinanceSpot } from "#platforms/binance-spot/BinanceSpot";

export const PLUGIN_ID: string = "2ae5e8d1-1101-4b9c-b6e1-e44497bb2803";
export const BINANCE_SPOT_PLATFORM_ID: string = "Binance/Spot";

export class BinancePlugin extends MidaPlugin {
    public constructor () {
        super({
            id: PLUGIN_ID,
            name: "Binance",
            version: "1.0.0",
            description: "",
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addPlatform(BINANCE_SPOT_PLATFORM_ID, new BinanceSpot());
    }
}
