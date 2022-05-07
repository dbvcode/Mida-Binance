import {
    GenericObject,
    MidaAsset, MidaAssetStatement,
    MidaDate,
    MidaOrder,
    MidaOrderDirection,
    MidaOrderDirectives,
    MidaOrderPurpose,
    MidaOrderStatus,
    MidaOrderTimeInForce,
    MidaPeriod,
    MidaPosition,
    MidaQuotationPrice,
    MidaSymbol,
    MidaTick,
    MidaTickMovement,
    MidaTrade,
    MidaTradeDirection,
    MidaTradePurpose,
    MidaTradeStatus,
    MidaTradingAccount,
} from "@reiryoku/mida";
import {
    AccountSnapshot,
    AssetBalance,
    Binance,
    CandlesOptions,
    MyTrade,
    NewOrderSpot,
} from "binance-api-node";
import { BinanceSpotAccountParameters } from "#platforms/binance-spot/BinanceSpotAccountParameters";
import { BinanceSpotTrade } from "#platforms/binance-spot/trades/BinanceSpotTrade";
import { BinanceSpotOrder } from "#platforms/binance-spot/orders/BinanceSpotOrder";

export class BinanceSpotAccount extends MidaTradingAccount {
    readonly #binanceConnection: Binance;
    readonly #assets: Map<string, MidaAsset>;
    readonly #symbols: Map<string, MidaSymbol>;
    readonly #ticksListeners: Map<string, boolean>;

    public constructor ({
        id,
        platform,
        creationDate,
        ownerName,
        primaryAsset,
        operativity,
        positionAccounting,
        indicativeLeverage,
        binanceConnection,
    }: BinanceSpotAccountParameters) {
        super({
            id,
            platform,
            creationDate,
            ownerName,
            primaryAsset,
            operativity,
            positionAccounting,
            indicativeLeverage,
        });

        this.#binanceConnection = binanceConnection;
        this.#assets = new Map();
        this.#symbols = new Map();
        this.#ticksListeners = new Map();
    }

    public override async placeOrder (directives: MidaOrderDirectives): Promise<MidaOrder> {
        if (directives.stop) {
            throw new Error("Binance Spot doesn't support stop orders");
        }

        if (directives.positionId || !directives.symbol) {
            throw new Error("Binance Spot doesn't support this order directives");
        }

        const symbol: string = directives.symbol as string;
        const volume: number = directives.volume;
        const binanceOrderDirectives: GenericObject = {
            symbol,
            side: directives.direction === MidaOrderDirection.BUY ? "BUY" : "SELL",
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
        const assetStatement: MidaAssetStatement = await this.#getAssetStatement(this.primaryAsset);

        return assetStatement.freeVolume + assetStatement.lockedVolume;
    }

    public override async getAssetBalance (asset: string): Promise<MidaAssetStatement> {
        return this.#getAssetStatement(asset);
    }

    public override async getBalanceSheet (): Promise<MidaAssetStatement[]> {
        const balanceSheet: MidaAssetStatement[] = [];
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            const totalVolume: number = Number(binanceAsset.free) + Number(binanceAsset.locked);

            if (totalVolume > 0) {
                balanceSheet.push({
                    tradingAccount: this,
                    date: new MidaDate(),
                    asset: binanceAsset.asset,
                    freeVolume: Number(binanceAsset.free),
                    lockedVolume: Number(binanceAsset.locked),
                    borrowedVolume: 0,
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

    public override async getTrades (symbol: string): Promise<MidaTrade[]> {
        const deals: MidaTrade[] = [];
        const binanceDeals: MyTrade[] = await this.#binanceConnection.myTrades({ symbol, });

        for (const binanceDeal of binanceDeals) {
            deals.push(new BinanceSpotTrade({
                orderId: binanceDeal.orderId.toString(),
                tradingAccount: this,
                symbol,
                commission: Number(binanceDeal.commission),
                commissionAsset: binanceDeal.commissionAsset.toString(),
                direction: binanceDeal.isBuyer ? MidaTradeDirection.BUY : MidaTradeDirection.SELL,
                executionDate: new MidaDate(Number(binanceDeal.time)),
                executionPrice: Number(binanceDeal.price),
                id: binanceDeal.id.toString(),
                purpose: binanceDeal.isBuyer ? MidaTradePurpose.OPEN : MidaTradePurpose.CLOSE,
                requestDate: new MidaDate(Number(binanceDeal.time)),
                status: MidaTradeStatus.EXECUTED,
                volume: Number(binanceDeal.qty),
            }));
        }

        return deals;
    }

    async #normalizePlainOrder (plainOrder: GenericObject): Promise<MidaOrder> {
        const creationDate: MidaDate | undefined = plainOrder.time ? new MidaDate(Number(plainOrder.time)) : undefined;
        let status: MidaOrderStatus;

        switch (plainOrder.status.toUpperCase()) {
            case "NEW": {
                if (plainOrder.type.toUpperCase() !== "MARKET") {
                    status = MidaOrderStatus.PENDING;
                }

                break;
            }
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaOrderStatus.EXECUTED;

                break;
            }
            case "PENDING_CANCEL":
            case "CANCELED": {
                status = MidaOrderStatus.CANCELLED;

                break;
            }
            case "EXPIRED": {
                status = MidaOrderStatus.EXPIRED;

                break;
            }
            case "REJECTED": {
                status = MidaOrderStatus.REJECTED;

                break;
            }
            default: {
                status = MidaOrderStatus.REQUESTED;
            }
        }

        return new BinanceSpotOrder({
            tradingAccount: this,
            creationDate,
            trades: [],
            direction: plainOrder.side === "BUY" ? MidaOrderDirection.BUY : MidaOrderDirection.SELL,
            id: plainOrder.orderId.toString(),
            isStopOut: false,
            lastUpdateDate: plainOrder.updateTime ? new MidaDate(Number(plainOrder.updateTime)) : creationDate?.clone(),
            limitPrice: 0,
            purpose: plainOrder.side === "BUY" ? MidaOrderPurpose.OPEN : MidaOrderPurpose.CLOSE,
            requestedVolume: Number(plainOrder.origQty),
            status: plainOrder.status === "FILLED" ? MidaOrderStatus.EXECUTED : MidaOrderStatus.REQUESTED,
            symbol: plainOrder.symbol,
            binanceConnection: this.#binanceConnection,
            timeInForce: MidaOrderTimeInForce.GOOD_TILL_CANCEL,
        });
    }

    public override async getOrders (symbol: string): Promise<MidaOrder[]> {
        const binanceOrders: GenericObject[] = await this.#binanceConnection.allOrders({ symbol, });
        const ordersPromises: Promise<MidaOrder>[] = [];

        for (const binanceOrder of binanceOrders) {
            ordersPromises.push(this.#normalizePlainOrder(binanceOrder));
        }

        return Promise.all(ordersPromises);
    }

    public override async getPendingOrders (): Promise<MidaOrder[]> {
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
                return new MidaAsset({ asset, tradingAccount: this, });
            }
        }

        return undefined;
    }

    async #getAssetStatement (asset: string): Promise<MidaAssetStatement> {
        const binanceAccountAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;
        const statement: MidaAssetStatement = {
            tradingAccount: this,
            date: new MidaDate(),
            asset,
            freeVolume: 0,
            lockedVolume: 0,
            borrowedVolume: 0,
        };

        for (const binanceAsset of binanceAccountAssets) {
            if (binanceAsset.asset === asset) {
                statement.freeVolume = Number(binanceAsset.free);
                statement.lockedVolume = Number(binanceAsset.locked);

                break;
            }
        }

        return statement;
    }

    async #getSymbolLastTick (symbol: string): Promise<MidaTick> {
        const lastPlainTick: GenericObject = (await this.#binanceConnection.allBookTickers())[symbol];

        return new MidaTick({
            ask: Number(lastPlainTick.askPrice),
            bid: Number(lastPlainTick.bidPrice),
            date: new MidaDate(),
            movement: MidaTickMovement.BID_ASK,
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

    public override async getSymbolPeriods (symbol: string, timeframe: number): Promise<MidaPeriod[]> {
        const periods: MidaPeriod[] = [];
        const binancePeriods: GenericObject[] = await this.#binanceConnection.candles(<CandlesOptions> {
            symbol,
            interval: toBinanceSpotTimeframe(timeframe),
        });

        for (const binancePeriod of binancePeriods) {
            periods.push(new MidaPeriod({
                symbol,
                close: Number(binancePeriod.close),
                high: Number(binancePeriod.high),
                low: Number(binancePeriod.low),
                open: Number(binancePeriod.open),
                quotationPrice: MidaQuotationPrice.BID,
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

    public override async getOpenPositions (): Promise<MidaPosition[]> {
        return [];
    }

    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        // Binance Spot crypto markets are always open
        return true;
    }

    public override async getCryptoAssetDepositAddress (asset: string, net: string): Promise<string> {
        return (await this.#binanceConnection.depositAddress({ coin: asset, network: net, })).address;
    }

    async #onTick (plainTick: GenericObject): Promise<void> {
        const symbol: string = plainTick.symbol;
        const tick: MidaTick = new MidaTick({
            ask: Number(plainTick.bestAsk),
            bid: Number(plainTick.bestBid),
            date: new MidaDate(),
            movement: MidaTickMovement.BID_ASK,
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
                tradingAccount: this,
                description: "",
                digits: -1,
                leverage: 0,
                lotUnits: 1,
                maxLots: -1,
                minLots: -1,
                quoteAsset: "",
                symbol: binanceSymbol,
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

export function toBinanceSpotTimeInForce (timeInForce: MidaOrderTimeInForce): string {
    switch (timeInForce) {
        case MidaOrderTimeInForce.GOOD_TILL_CANCEL: {
            return "GTC";
        }
        case MidaOrderTimeInForce.FILL_OR_KILL: {
            return "FOK";
        }
        case MidaOrderTimeInForce.IMMEDIATE_OR_CANCEL: {
            return "IOC";
        }
        default: {
            throw new Error("Binance Spot doesn't support this time in force");
        }
    }
}
