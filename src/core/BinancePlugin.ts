import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";

export class BinancePlugin extends MidaPlugin {
    public constructor () {
        super({
            id: "2ae5e8d1-1101-4b9c-b6e1-e44497bb2803",
            name: "Binance",
            version: "1.0.0",
            description: "",
        });
    }

    public override install (actions: MidaPluginActions): void {
        // actions.addBroker. . .
        // actions.addIndicator. . .
    }
}
