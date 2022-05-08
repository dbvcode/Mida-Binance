import { GenericObject } from "@reiryoku/mida";

import createBinanceConnection from "binance-api-node";

module.exports = require("!/plugin.mida").default;

const binance: GenericObject = createBinanceConnection({
    apiKey: "XYWvFzlJKpPQGLYdardpQ7ZViB0WeqxaKgYBUHwJNwIgaV3rxPY21yDhaRRfvwu4",
    apiSecret: "Vwxl4TkwBDkcvSQ8DrNyUIfHkxERVAjbeOT8nCl1UgfKy6O3gLOom2QJs0cqIBSt",
});

(async (): Promise<void> => {
    try {
        // console.log(await binance.buy("TRXUSDT", 200, 0.05665, { type: "LIMIT", }));
        // console.log(await binance.openOrders(false));

        const update = (a: any): void => {
            console.log(a);
        };
    }
    catch (error: any) {
        console.log(error.body);
    }
    /*
    binance.marketSell("TRXBNB", 1, (error: any, response: any) => {
        console.log(error.body);
        console.info("Market Buy response", response);
        console.info("order id: " + response.orderId);
        // Now you can limit sell with a stop loss, etc.
    });*/
})();
