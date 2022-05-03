import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount,
    MidaBrokerDeal,
    MidaBrokerDealDirection,
    MidaBrokerDealPurpose,
    MidaBrokerDealStatus,
    MidaBrokerOrder,
    MidaBrokerOrderDirection,
    MidaBrokerOrderDirectives,
    MidaBrokerOrderPurpose,
    MidaBrokerOrderStatus,
    MidaBrokerOrderTimeInForce,
    MidaBrokerPosition,
    MidaDate,
    MidaSymbol,
    MidaSymbolCategory,
    MidaSymbolPeriod,
    MidaSymbolPriceType,
    MidaSymbolTick,
    MidaSymbolTickMovementType,
    MidaUnsupportedOperationError,
} from "@reiryoku/mida";
import { BinanceSpotBrokerAccountParameters } from "#brokers/binance-spot/BinanceSpotBrokerAccountParameters";
import { BinanceSpotBrokerDeal } from "#brokers/binance-spot/deals/BinanceSpotBrokerDeal";
import { BinanceSpotBrokerOrder } from "#brokers/binance-spot/orders/BinanceSpotBrokerOrder";

export class BinanceSpotBrokerAccount extends MidaBrokerAccount {
    readonly #binanceHandler: GenericObject;
    readonly #assets: Map<string, MidaAsset>;
    readonly #symbols: Map<string, MidaSymbol>;
    readonly #ticksListeners: Map<string, boolean>;

    public constructor ({
        id,
        broker,
        creationDate,
        ownerName,
        depositCurrencyIso,
        depositCurrencyDigits,
        operativity,
        positionAccounting,
        indicativeLeverage,
        binanceHandler,
    }: BinanceSpotBrokerAccountParameters) {
        super({
            id,
            broker,
            creationDate,
            ownerName,
            depositCurrencyIso,
            depositCurrencyDigits,
            operativity,
            positionAccounting,
            indicativeLeverage,
        });

        this.#binanceHandler = binanceHandler;
        this.#assets = new Map();
        this.#symbols = new Map();
        this.#ticksListeners = new Map();
    }

    public async preload (): Promise<void> {
        await Promise.all([ this.#preloadSymbols(), ]);
    }

    public override async placeOrder (directives: MidaBrokerOrderDirectives): Promise<MidaBrokerOrder> {
        if (directives.stop) {
            throw new Error("Stop orders are not supported on Binance Spot");
        }

        const symbol: string = directives.symbol as string;
        const volume: number = directives.volume;
        let plainOrder: GenericObject;

        if (directives.direction === MidaBrokerOrderDirection.BUY) {
            if (directives.limit) {
                plainOrder = await this.#binanceHandler.buy(symbol, volume, directives.limit, { type: "LIMIT", });
            }
            else {
                plainOrder = await this.#binanceHandler.marketBuy(symbol, volume);
            }
        }
        else {
            if (directives.limit) {
                plainOrder = await this.#binanceHandler.sell(symbol, volume, directives.limit, { type: "LIMIT", });
            }
            else {
                plainOrder = await this.#binanceHandler.marketSell(symbol, volume);
            }
        }

        return this.#normalizePlainOrder(plainOrder);
    }


    public override async getBalance (): Promise<number> {
        const ownedAssets: Map<string, number> = await this.getOwnedAssets();

        return ownedAssets.get(this.depositCurrencyIso) ?? 0;
    }

    public override async getEquity (): Promise<number> {
        // TODO: TODO get all BTC and convert BTC to deposit asset
        return 0;
    }

    public override async getUsedMargin (): Promise<number> {
        return 0;
    }

    public override async getFreeMargin (): Promise<number> {
        return 0;
    }

    public override async getMarginLevel (): Promise<number> {
        return NaN;
    }

    // @ts-ignore
    public override async getDeals (symbol: string): Promise<MidaBrokerDeal[]> {
        const deals: MidaBrokerDeal[] = [];
        const plainDeals: GenericObject[] = await this.#binanceHandler.myTrades(symbol);

        for (const plainDeal of plainDeals) {
            deals.push(new BinanceSpotBrokerDeal({
                commission: Number(plainDeal.commission),
                direction: plainDeal.isBuyer ? MidaBrokerDealDirection.BUY : MidaBrokerDealDirection.SELL,
                executionDate: new MidaDate(Number(plainDeal.time)),
                executionPrice: Number(plainDeal.price),
                grossProfit: 0,
                id: plainDeal.id.toString(),
                order: {} as MidaBrokerOrder,
                position: undefined,
                purpose: plainDeal.isBuyer ? MidaBrokerDealPurpose.OPEN : MidaBrokerDealPurpose.CLOSE,
                requestDate: new MidaDate(Number(plainDeal.time)),
                status: MidaBrokerDealStatus.EXECUTED,
                swap: 0,
                volume: Number(plainDeal.qty),
            }));
        }

        return deals;
    }

    async #normalizePlainOrder (plainOrder: GenericObject): Promise<MidaBrokerOrder> {
        const creationDate: MidaDate = new MidaDate(Number(plainOrder.time));
        let status: MidaBrokerOrderStatus;

        switch (plainOrder.status.toUpperCase()) {
            case "NEW": {
                if (plainOrder.type.toUpperCase() !== "MARKET") {
                    status = MidaBrokerOrderStatus.PENDING;
                }

                break;
            }
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaBrokerOrderStatus.EXECUTED;

                break;
            }
            case "PENDING_CANCEL":
            case "CANCELED": {
                status = MidaBrokerOrderStatus.CANCELLED;

                break;
            }
            case "EXPIRED": {
                status = MidaBrokerOrderStatus.EXPIRED;

                break;
            }
            case "REJECTED": {
                status = MidaBrokerOrderStatus.REJECTED;

                break;
            }
            default: {
                status = MidaBrokerOrderStatus.REQUESTED;
            }
        }

        return new BinanceSpotBrokerOrder({
            // @ts-ignore
            brokerAccount: this,
            creationDate,
            deals: [],
            direction: plainOrder.side === "BUY" ? MidaBrokerOrderDirection.BUY : MidaBrokerOrderDirection.SELL,
            id: plainOrder.orderId.toString(),
            isStopOut: false,
            lastUpdateDate: plainOrder.updateTime ? new MidaDate(Number(plainOrder.updateTime)) : creationDate.clone(),
            limitPrice: 0,
            position: undefined,
            purpose: plainOrder.side === "BUY" ? MidaBrokerOrderPurpose.OPEN : MidaBrokerOrderPurpose.CLOSE,
            requestedVolume: Number(plainOrder.origQty),
            status: plainOrder.status === "FILLED" ? MidaBrokerOrderStatus.EXECUTED : MidaBrokerOrderStatus.REQUESTED,
            symbol: plainOrder.symbol,
            binanceHandler: this.#binanceHandler,
            timeInForce: MidaBrokerOrderTimeInForce.GOOD_TILL_CANCEL,
        });
    }

    // @ts-ignore
    public override async getOrders (symbol: string): Promise<MidaBrokerOrder[]> {
        const orders: MidaBrokerOrder[] = [];
        const plainOrders: GenericObject[] = await this.#binanceHandler.allOrders({ symbol, });

        for (const plainOrder of plainOrders) {
            orders.push(await this.#normalizePlainOrder(plainOrder));
        }

        return orders;
    }

    public override async getPendingOrders (): Promise<MidaBrokerOrder[]> {
        const pendingOrders: MidaBrokerOrder[] = [];
        const plainPendingOrders: GenericObject[] = await this.#binanceHandler.allOrders({ symbol, });

        for (const plainOrder of plainPendingOrders) {
            pendingOrders.push(await this.#normalizePlainOrder(plainOrder));
        }

        return pendingOrders;
    }

    public async getAssets (): Promise<MidaAsset[]> {
        const assets: MidaAsset[] = [];
        const plainAssets: GenericObject[] = (await this.#binanceHandler.accountInfo()).balances;

        for (const plainAsset of plainAssets) {
            assets.push(new MidaAsset({
                id: plainAsset.asset,
                name: plainAsset.asset,
                // @ts-ignore
                brokerAccount: this,
            }));
        }

        return assets;
    }

    public async getOwnedAssets (): Promise<Map<string, number>> {
        const ownedAssets: Map<string, number> = new Map();
        const plainAssets: GenericObject[] = (await this.#binanceHandler.accountInfo()).balances;

        for (const plainAsset of plainAssets) {
            const ownedVolume: number = Number(plainAsset.free);

            if (Number.isFinite(ownedVolume) && ownedVolume > 0) {
                ownedAssets.set(plainAsset.asset, ownedVolume);
            }
        }

        return ownedAssets;
    }

    public override async getSymbolLastTick (symbol: string): Promise<MidaSymbolTick> {
        const lastPlainTick: GenericObject = await this.#binanceHandler.bookTickers(symbol);

        return new MidaSymbolTick({
            ask: Number(lastPlainTick.askPrice),
            bid: Number(lastPlainTick.bidPrice),
            date: new MidaDate(),
            movementType: MidaSymbolTickMovementType.BID_ASK,
            symbol,
        });
    }

    public override async getSymbolBid (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<number> {
        return (await this.getSymbolLastTick(symbol)).ask;
    }

    public override async getSymbolPeriods (symbol: string, timeframe: number, priceType?: MidaSymbolPriceType): Promise<MidaSymbolPeriod[]> {
        const periods: MidaSymbolPeriod[] = [];
        const plainPeriods: any[] = this.#binanceHandler.candlesticks(symbol, normalizeTimeframe(timeframe));

        for (const plainPeriod of plainPeriods) {
            const [
                plainStartTimestamp,
                plainOpen,
                plainHigh,
                plainLow,
                plainClose,
                plainVolume,
            ] = plainPeriod;

            periods.push(new MidaSymbolPeriod({
                symbol,
                close: Number(plainClose),
                high: Number(plainHigh),
                low: Number(plainLow),
                open: Number(plainOpen),
                priceType: MidaSymbolPriceType.BID,
                startDate: new MidaDate(Number(plainStartTimestamp)),
                timeframe,
                volume: Number(plainVolume),
            }));
        }

        return periods;
    }

    public override async getSymbols (): Promise<string[]> {
        return [ ...this.#symbols.keys(), ];
    }

    public override async getSymbol (symbol: string): Promise<MidaSymbol | undefined> {
        return this.#symbols.get(symbol);
    }

    public override async getDealById (): Promise<MidaBrokerDeal | undefined> {
        throw new MidaUnsupportedOperationError();
    }

    public override async getPositionById (): Promise<MidaBrokerPosition | undefined> {
        throw new MidaUnsupportedOperationError();
    }

    public override async getOrderById (): Promise<MidaBrokerOrder | undefined> {
        throw new MidaUnsupportedOperationError();
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        if (this.#ticksListeners.has(symbol)) {
            return;
        }

        await this.#binanceHandler.websockets.bookTickers(symbol, (plainTick: GenericObject) => this.#onTick(plainTick));

        this.#ticksListeners.set(symbol, true);
    }

    public override async getPositions (): Promise<MidaBrokerPosition[]> {
        return [];
    }

    public override async getOpenPositions (): Promise<MidaBrokerPosition[]> {
        return [];
    }

    public override async isSymbolMarketOpen (): Promise<boolean> {
        return true;
    }

    public override async logout (): Promise<void> {}

    public async getAssetDepositAddress (asset: string): Promise<string> {
        return (await this.#binanceHandler.depositAddress({ coin: asset, })).address;
    }

    async #onTick (plainTick: GenericObject): Promise<void> {
        const symbol: string = plainTick.symbol;
        const tick: MidaSymbolTick = new MidaSymbolTick({
            ask: Number(plainTick.bestAsk),
            bid: Number(plainTick.bestBid),
            date: new MidaDate(),
            movementType: MidaSymbolTickMovementType.BID_ASK,
            symbol,
        });

        if (this.#ticksListeners.has(symbol)) {
            this.notifyListeners("tick", { tick, });
        }
    }

    async #preloadSymbols (): Promise<void> {
        const plainSymbols: string[] = Object.keys(await this.#binanceHandler.prices());

        this.#symbols.clear();

        for (const plainSymbol of plainSymbols) {
            this.#symbols.set(plainSymbol, new MidaSymbol({
                baseAsset: {} as MidaAsset,
                // @ts-ignore
                brokerAccount: this,
                description: "",
                digits: -1,
                leverage: 0,
                lotUnits: 1,
                maxLots: -1,
                minLots: -1,
                quoteAsset: {} as MidaAsset,
                symbol: plainSymbol,
                type: MidaSymbolCategory.CRYPTO,
            }));
        }
    }
}

export function normalizeTimeframe (timeframe: number): string {
    switch (timeframe) {
        case 60: {
            return "1m";
        }
        case 180: {
            return "3m";
        }
        case 300: {
            return "5m";
        }
        case 900: {
            return "15m";
        }
        case 1800: {
            return "30m";
        }
        case 3600: {
            return "1h";
        }
        case 14400: {
            return "2h";
        }
        case 43200: {
            return "12h";
        }
        case 86400: {
            return "1d";
        }
        case 604800: {
            return "1w";
        }
        case 2592000: {
            return "1M";
        }
        default: {
            throw new Error("Unsupported timeframe");
        }
    }
}
