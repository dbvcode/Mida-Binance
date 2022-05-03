import {
    GenericObject,
    MidaAsset,
    MidaBrokerAccount,
    MidaBrokerAccountAssetStatement,
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
} from "@reiryoku/mida";
import { AccountSnapshot, AssetBalance, Binance, CandlesOptions, MyTrade, NewOrderSpot, } from "binance-api-node";
import { BinanceSpotBrokerAccountParameters } from "#brokers/binance-spot/BinanceSpotBrokerAccountParameters";
import { BinanceSpotBrokerDeal } from "#brokers/binance-spot/deals/BinanceSpotBrokerDeal";
import { BinanceSpotBrokerOrder } from "#brokers/binance-spot/orders/BinanceSpotBrokerOrder";

export class BinanceSpotBrokerAccount extends MidaBrokerAccount {
    readonly #binanceConnection: Binance;
    readonly #assets: Map<string, MidaAsset>;
    readonly #symbols: Map<string, MidaSymbol>;
    readonly #ticksListeners: Map<string, boolean>;

    public constructor ({
        id,
        broker,
        creationDate,
        ownerName,
        depositAsset,
        operativity,
        positionAccounting,
        indicativeLeverage,
        binanceConnection,
    }: BinanceSpotBrokerAccountParameters) {
        super({
            id,
            broker,
            creationDate,
            ownerName,
            depositAsset,
            operativity,
            positionAccounting,
            indicativeLeverage,
        });

        this.#binanceConnection = binanceConnection;
        this.#assets = new Map();
        this.#symbols = new Map();
        this.#ticksListeners = new Map();
    }

    public override async placeOrder (directives: MidaBrokerOrderDirectives): Promise<MidaBrokerOrder> {
        if (directives.stop) {
            throw new Error("Binance Spot doesn't support stop orders");
        }

        if (directives.positionId) {
            throw new Error("Binance Spot doesn't support this order directives");
        }

        const symbol: string = directives.symbol as string;
        const volume: number = directives.volume;
        const binanceOrderDirectives: GenericObject = {
            symbol,
            side: directives.direction === MidaBrokerOrderDirection.BUY ? "BUY" : "SELL",
            quantity: volume.toString(),
        };

        if (directives.limit) {
            binanceOrderDirectives.price = directives.limit.toString();
        }

        if (directives.timeInForce) {
            binanceOrderDirectives.timeInForce = toBinanceSpotTimeInForce(directives.timeInForce);
        }

        return this.#normalizePlainOrder(await this.#binanceConnection.order(<NewOrderSpot> binanceOrderDirectives));
    }

    public override async getBalance (): Promise<number> {
        const assetStatement: MidaBrokerAccountAssetStatement = await this.getAssetStatement(this.depositAsset);

        return assetStatement.freeVolume + assetStatement.lockedVolume;
    }

    public override async getBalanceSheet (): Promise<MidaBrokerAccountAssetStatement[]> {
        const balanceSheet: MidaBrokerAccountAssetStatement[] = [];
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            const totalVolume: number = Number(binanceAsset.free) + Number(binanceAsset.locked);

            if (totalVolume > 0) {
                balanceSheet.push({
                    brokerAccount: this,
                    date: new MidaDate(),
                    asset: binanceAsset.asset,
                    freeVolume: Number(binanceAsset.free),
                    lockedVolume: Number(binanceAsset.locked),
                });
            }
        }

        return balanceSheet;
    }

    public override async getEquity (): Promise<number> {
        const accountSnapshot: AccountSnapshot = await this.#binanceConnection.accountSnapshot({ type: "SPOT", });

        // Return the total BTC balance if all the other assets were liquidated
        return Number(accountSnapshot.snapshotVos[0].data.totalAssetOfBtc);
    }

    public override async getUsedMargin (): Promise<number> {
        // Binance Spot doesn't support margin trading
        return 0;
    }

    public override async getFreeMargin (): Promise<number> {
        // Binance Spot doesn't support margin trading
        return 0;
    }

    public override async getMarginLevel (): Promise<number> {
        // Binance Spot doesn't support margin trading
        return NaN;
    }

    public override async getDeals (symbol: string): Promise<MidaBrokerDeal[]> {
        const deals: MidaBrokerDeal[] = [];
        const binanceDeals: MyTrade[] = await this.#binanceConnection.myTrades({ symbol, });

        for (const binanceDeal of binanceDeals) {
            deals.push(new BinanceSpotBrokerDeal({
                commission: Number(binanceDeal.commission),
                commissionAsset: binanceDeal.commissionAsset,
                direction: binanceDeal.isBuyer ? MidaBrokerDealDirection.BUY : MidaBrokerDealDirection.SELL,
                executionDate: new MidaDate(Number(binanceDeal.time)),
                executionPrice: Number(binanceDeal.price),
                grossProfit: 0,
                id: binanceDeal.id.toString(),
                order: {} as MidaBrokerOrder,
                position: undefined,
                purpose: binanceDeal.isBuyer ? MidaBrokerDealPurpose.OPEN : MidaBrokerDealPurpose.CLOSE,
                requestDate: new MidaDate(Number(binanceDeal.time)),
                status: MidaBrokerDealStatus.EXECUTED,
                swap: 0,
                volume: Number(binanceDeal.qty),
            }));
        }

        return deals;
    }

    async #normalizePlainOrder (plainOrder: GenericObject): Promise<MidaBrokerOrder> {
        const creationDate: MidaDate | undefined = plainOrder.time ? new MidaDate(Number(plainOrder.time)) : undefined;
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
            brokerAccount: this,
            creationDate,
            deals: [],
            direction: plainOrder.side === "BUY" ? MidaBrokerOrderDirection.BUY : MidaBrokerOrderDirection.SELL,
            id: plainOrder.orderId.toString(),
            isStopOut: false,
            lastUpdateDate: plainOrder.updateTime ? new MidaDate(Number(plainOrder.updateTime)) : creationDate?.clone(),
            limitPrice: 0,
            position: undefined,
            purpose: plainOrder.side === "BUY" ? MidaBrokerOrderPurpose.OPEN : MidaBrokerOrderPurpose.CLOSE,
            requestedVolume: Number(plainOrder.origQty),
            status: plainOrder.status === "FILLED" ? MidaBrokerOrderStatus.EXECUTED : MidaBrokerOrderStatus.REQUESTED,
            symbol: plainOrder.symbol,
            binanceConnection: this.#binanceConnection,
            timeInForce: MidaBrokerOrderTimeInForce.GOOD_TILL_CANCEL,
        });
    }

    public override async getOrders (symbol: string): Promise<MidaBrokerOrder[]> {
        const binanceOrders: GenericObject[] = await this.#binanceConnection.allOrders({ symbol, });
        const ordersPromises: Promise<MidaBrokerOrder>[] = [];

        for (const binanceOrder of binanceOrders) {
            ordersPromises.push(this.#normalizePlainOrder(binanceOrder));
        }

        return Promise.all(ordersPromises);
    }

    public override async getPendingOrders (): Promise<MidaBrokerOrder[]> {
        return [];
    }

    public async getAssets (): Promise<string[]> {
        const assets: string[] = [];
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            assets.push(binanceAsset.asset);
        }

        return assets;
    }

    public override async getAsset (asset: string): Promise<MidaAsset | undefined> {
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            if (binanceAsset.asset === asset) {
                return new MidaAsset({
                    id: binanceAsset.asset,
                    name: binanceAsset.asset,
                    brokerAccount: this,
                });
            }
        }

        return undefined;
    }

    public override async getAssetStatement (asset: string): Promise<MidaBrokerAccountAssetStatement> {
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            if (binanceAsset.asset === asset) {
                return {
                    brokerAccount: this,
                    date: new MidaDate(),
                    asset,
                    freeVolume: Number(binanceAsset.free),
                    lockedVolume: Number(binanceAsset.locked),
                };
            }
        }

        return {
            brokerAccount: this,
            date: new MidaDate(),
            asset,
            freeVolume: 0,
            lockedVolume: 0,
        };
    }

    async #getSymbolLastTick (symbol: string): Promise<MidaSymbolTick> {
        const lastPlainTick: GenericObject = (await this.#binanceConnection.allBookTickers())[symbol];

        return new MidaSymbolTick({
            ask: Number(lastPlainTick.askPrice),
            bid: Number(lastPlainTick.bidPrice),
            date: new MidaDate(),
            movementType: MidaSymbolTickMovementType.BID_ASK,
            symbol,
        });
    }

    public override async getSymbolBid (symbol: string): Promise<number> {
        return (await this.#getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<number> {
        return (await this.#getSymbolLastTick(symbol)).ask;
    }

    public override async getSymbolAveragePrice (symbol: string): Promise<number> {
        return (await this.getSymbolBid(symbol) + await this.getSymbolAsk(symbol)) / 2;
    }

    public override async getSymbolPeriods (symbol: string, timeframe: number): Promise<MidaSymbolPeriod[]> {
        const periods: MidaSymbolPeriod[] = [];
        const binancePeriods: GenericObject[] = await this.#binanceConnection.candles(<CandlesOptions> {
            symbol,
            interval: toBinanceSpotTimeframe(timeframe),
        });

        for (const binancePeriod of binancePeriods) {
            periods.push(new MidaSymbolPeriod({
                symbol,
                close: Number(binancePeriod.close),
                high: Number(binancePeriod.high),
                low: Number(binancePeriod.low),
                open: Number(binancePeriod.open),
                priceType: MidaSymbolPriceType.BID,
                startDate: new MidaDate(Number(binancePeriod.openTime)),
                timeframe,
                volume: Number(binancePeriod.volume),
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

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        if (this.#ticksListeners.has(symbol)) {
            return;
        }

        this.#binanceConnection.ws.ticker(symbol, (plainTick: GenericObject) => this.#onTick(plainTick));

        this.#ticksListeners.set(symbol, true);
    }

    public override async getOpenPositions (): Promise<MidaBrokerPosition[]> {
        return [];
    }

    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        // Binance Spot crypto markets are always open
        return true;
    }

    public override async getAssetDepositAddress (asset: string): Promise<string> {
        return (await this.#binanceConnection.depositAddress({ coin: asset, })).address;
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
        const binanceSymbols: string[] = Object.keys(await this.#binanceConnection.prices());

        this.#symbols.clear();

        for (const binanceSymbol of binanceSymbols) {
            this.#symbols.set(binanceSymbol, new MidaSymbol({
                baseAsset: "",
                brokerAccount: this,
                description: "",
                digits: -1,
                leverage: 0,
                lotUnits: 1,
                maxLots: -1,
                minLots: -1,
                quoteAsset: "",
                symbol: binanceSymbol,
                type: MidaSymbolCategory.CRYPTO,
            }));
        }
    }
}

export function toBinanceSpotTimeframe (timeframe: number): string {
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
            throw new Error("Binance Spot doesn't support this timeframe");
        }
    }
}

export function toBinanceSpotTimeInForce (timeInForce: MidaBrokerOrderTimeInForce): string {
    switch (timeInForce) {
        case MidaBrokerOrderTimeInForce.GOOD_TILL_CANCEL: {
            return "GTC";
        }
        case MidaBrokerOrderTimeInForce.FILL_OR_KILL: {
            return "FOK";
        }
        case MidaBrokerOrderTimeInForce.IMMEDIATE_OR_CANCEL: {
            return "IOC";
        }
        default: {
            throw new Error("Binance Spot doesn't support this time in force");
        }
    }
}
