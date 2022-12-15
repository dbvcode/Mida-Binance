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
    GenericObject,
    MidaAsset,
    MidaAssetStatement,
    MidaDate,
    MidaDecimal,
    MidaEmitter,
    MidaEventListener,
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
    MidaSymbolTradeStatus,
    MidaTick,
    MidaTickMovement,
    MidaTrade,
    MidaTradeDirection,
    MidaTradePurpose,
    MidaTradeStatus,
    MidaTradingAccount,
    warn,
} from "@reiryoku/mida";
import {
    AssetBalance,
    AvgPriceResult,
    Binance,
    CandlesOptions,
    MyTrade,
    Symbol as BinanceSymbol,
} from "binance-api-node";
import { BinanceSpotAccountParameters, } from "#platforms/binance-spot/BinanceSpotAccountParameters";
import { BinanceSpotTrade, } from "#platforms/binance-spot/trades/BinanceSpotTrade";
import { BinanceSpotOrder, } from "#platforms/binance-spot/orders/BinanceSpotOrder";

const DEFAULT_RESOLVER_EVENTS: string[] = [
    "reject",
    "pending",
    "cancel",
    "expire",
    "execute",
];

export class BinanceSpotAccount extends MidaTradingAccount {
    readonly #binanceConnection: Binance;
    readonly #binanceEmitter: MidaEmitter;
    readonly #assets: Map<string, MidaAsset>;
    readonly #symbols: Map<string, MidaSymbol>;
    readonly #tickListeners: Map<string, boolean>;
    readonly #periodListeners: Map<string, number[]>;
    readonly #lastTicks: Map<string, MidaTick>;

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
        this.#binanceEmitter = new MidaEmitter();
        this.#assets = new Map();
        this.#symbols = new Map();
        this.#tickListeners = new Map();
        this.#periodListeners = new Map();
        this.#lastTicks = new Map();
    }

    public async preload (): Promise<void> {
        await this.#preloadSymbols();
        await this.#configureListeners();
    }

    public override async placeOrder (directives: MidaOrderDirectives): Promise<MidaOrder> {
        const symbol: string = directives.symbol as string;
        const direction: MidaOrderDirection = directives.direction;
        const requestedVolume: MidaDecimal = decimal(directives.volume);
        const order: BinanceSpotOrder = new BinanceSpotOrder({
            id: "",
            direction,
            limitPrice: directives.limit !== undefined ? decimal(directives.limit) : undefined,
            purpose: direction === MidaOrderDirection.BUY ? MidaOrderPurpose.OPEN : MidaOrderPurpose.CLOSE,
            requestedVolume,
            status: MidaOrderStatus.REQUESTED,
            symbol,
            timeInForce: directives.timeInForce ?? MidaOrderTimeInForce.GOOD_TILL_CANCEL,
            tradingAccount: this,
            binanceConnection: this.#binanceConnection,
            binanceEmitter: this.#binanceEmitter,
            directives,
            isStopOut: false,
            trades: [],
        });

        const listeners: { [eventType: string]: MidaEventListener } = directives.listeners ?? {};
        const resolver: Promise<BinanceSpotOrder> = new Promise((resolve: (order: BinanceSpotOrder) => void) => {
            const events: string[] = directives.resolverEvents ?? DEFAULT_RESOLVER_EVENTS;

            if (events.length === 0) {
                resolve(order);
            }
            else {
                const resolverEventsUuids: Map<string, string> = new Map();

                for (const eventType of events) {
                    resolverEventsUuids.set(eventType, order.on(eventType, (): void => {
                        for (const uuid of [ ...resolverEventsUuids.values(), ]) {
                            order.removeEventListener(uuid);
                        }

                        resolve(order);
                    }));
                }
            }
        });

        for (const eventType of Object.keys(listeners)) {
            order.on(eventType, listeners[eventType]);
        }

        this.notifyListeners("order", { order, });
        order.send();

        return resolver;
    }

    public override async getBalance (): Promise<MidaDecimal> {
        const assetStatement: MidaAssetStatement = await this.#getAssetStatement(this.primaryAsset);

        return decimal(assetStatement.freeVolume).add(assetStatement.lockedVolume).add(assetStatement.borrowedVolume);
    }

    public override async getAssetBalance (asset: string): Promise<MidaAssetStatement> {
        return this.#getAssetStatement(asset);
    }

    public override async getBalanceSheet (): Promise<MidaAssetStatement[]> {
        const balanceSheet: MidaAssetStatement[] = [];
        const binanceAssets: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;

        for (const binanceAsset of binanceAssets) {
            const totalVolume: MidaDecimal = decimal(binanceAsset.free).add(binanceAsset.locked);

            if (totalVolume.greaterThan(0)) {
                balanceSheet.push({
                    tradingAccount: this,
                    date: date(),
                    asset: binanceAsset.asset,
                    freeVolume: decimal(binanceAsset.free),
                    lockedVolume: decimal(binanceAsset.locked),
                    borrowedVolume: decimal(0),
                });
            }
        }

        return balanceSheet;
    }

    public override async getEquity (): Promise<MidaDecimal> {
        const balanceSheet: MidaAssetStatement[] = await this.getBalanceSheet();
        const lastQuotations: GenericObject = await this.#binanceConnection.allBookTickers();
        let totalPrimaryAssetBalance: MidaDecimal = decimal(0);

        for (const assetStatement of balanceSheet) {
            const asset: string = assetStatement.asset;
            const totalAssetBalance: MidaDecimal = assetStatement.freeVolume.add(assetStatement.lockedVolume);

            if (this.primaryAsset === asset) {
                totalPrimaryAssetBalance = totalPrimaryAssetBalance.add(totalAssetBalance);

                continue;
            }

            let exchangeRate: GenericObject = lastQuotations[asset + this.primaryAsset];

            if (exchangeRate) {
                totalPrimaryAssetBalance = totalPrimaryAssetBalance.add(totalAssetBalance.multiply(exchangeRate.bidPrice));

                continue;
            }

            exchangeRate = lastQuotations[this.primaryAsset + asset];

            if (!exchangeRate) {
                warn(`You own ${totalAssetBalance.toString()} ${asset}`);
                warn(`Exchange rate for ${asset}/${this.primaryAsset} not available: excluded from equity calculation`);

                continue;
            }

            totalPrimaryAssetBalance = totalPrimaryAssetBalance.add(totalAssetBalance.divide(exchangeRate.bidPrice));
        }

        return totalPrimaryAssetBalance;
    }

    public override async getUsedMargin (): Promise<MidaDecimal> {
        // Binance Spot doesn't support margin trading
        return decimal(0);
    }

    public override async getFreeMargin (): Promise<MidaDecimal> {
        // Binance Spot doesn't support margin trading
        return decimal(0);
    }

    public override async getMarginLevel (): Promise<MidaDecimal | undefined> {
        // Binance Spot doesn't support margin trading
        return undefined;
    }

    public override async getTrades (symbol: string): Promise<MidaTrade[]> {
        const trades: MidaTrade[] = [];
        const binanceDeals: MyTrade[] = await this.#binanceConnection.myTrades({ symbol, });

        for (const binanceDeal of binanceDeals) {
            trades.push(new BinanceSpotTrade({
                orderId: binanceDeal.orderId.toString(),
                positionId: "",
                tradingAccount: this,
                symbol,
                commission: decimal(binanceDeal.commission),
                commissionAsset: binanceDeal.commissionAsset.toString(),
                direction: binanceDeal.isBuyer ? MidaTradeDirection.BUY : MidaTradeDirection.SELL,
                executionDate: date(binanceDeal.time),
                executionPrice: decimal(binanceDeal.price),
                id: binanceDeal.id.toString(),
                purpose: binanceDeal.isBuyer ? MidaTradePurpose.OPEN : MidaTradePurpose.CLOSE,
                status: MidaTradeStatus.EXECUTED,
                volume: decimal(binanceDeal.qty),
            }));
        }

        return trades;
    }

    #normalizeOrder (plainOrder: GenericObject): MidaOrder {
        const creationDate: MidaDate | undefined = plainOrder.time ? new MidaDate(plainOrder.time) : undefined;
        let status: MidaOrderStatus = MidaOrderStatus.REQUESTED;

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
        }

        return new BinanceSpotOrder({
            tradingAccount: this,
            creationDate,
            trades: [],
            direction: plainOrder.side === "BUY" ? MidaOrderDirection.BUY : MidaOrderDirection.SELL,
            id: plainOrder.orderId.toString(),
            isStopOut: false,
            lastUpdateDate: plainOrder.updateTime ? new MidaDate(Number(plainOrder.updateTime)) : creationDate,
            limitPrice: plainOrder.type === "LIMIT" ? decimal(plainOrder.price) : undefined,
            purpose: plainOrder.side === "BUY" ? MidaOrderPurpose.OPEN : MidaOrderPurpose.CLOSE,
            requestedVolume: decimal(plainOrder.origQty),
            status,
            symbol: plainOrder.symbol,
            timeInForce: normalizeTimeInForce(plainOrder.timeInForce),
            binanceConnection: this.#binanceConnection,
            binanceEmitter: this.#binanceEmitter,
        });
    }

    public override async getOrders (symbol: string): Promise<MidaOrder[]> {
        const binanceOrders: GenericObject[] = await this.#binanceConnection.allOrders({ symbol, });
        const executedOrders: MidaOrder[] = [];

        for (const binanceOrder of binanceOrders) {
            const order = this.#normalizeOrder(binanceOrder);

            if (order.isExecuted) {
                executedOrders.push(order);
            }
        }

        return executedOrders;
    }

    public override async getPendingOrders (): Promise<MidaOrder[]> {
        const binanceOrders: GenericObject[] = await this.#binanceConnection.openOrders({});
        const pendingOrders: MidaOrder[] = [];

        for (const binanceOrder of binanceOrders) {
            const order = this.#normalizeOrder(binanceOrder);

            if (order.status === MidaOrderStatus.PENDING) {
                pendingOrders.push(order);
            }
        }

        return pendingOrders;
    }

    public async getAssets (): Promise<string[]> {
        const assets: Set<string> = new Set();

        for (const symbol of [ ...this.#symbols.values(), ]) {
            assets.add(symbol.baseAsset);
            assets.add(symbol.quoteAsset);
        }

        return [ ...assets, ];
    }

    public override async getAsset (asset: string): Promise<MidaAsset | undefined> {
        const assets: string[] = await this.getAssets();

        if (assets.includes(asset)) {
            return new MidaAsset({ asset, tradingAccount: this, });
        }

        return undefined;
    }

    async #getAssetStatement (asset: string): Promise<MidaAssetStatement> {
        const balanceSheet: AssetBalance[] = (await this.#binanceConnection.accountInfo()).balances;
        const statement: MidaAssetStatement = {
            tradingAccount: this,
            date: date(),
            asset,
            freeVolume: decimal(0),
            lockedVolume: decimal(0),
            borrowedVolume: decimal(0),
        };

        for (const binanceAsset of balanceSheet) {
            if (binanceAsset.asset === asset) {
                statement.freeVolume = decimal(binanceAsset.free);
                statement.lockedVolume = decimal(binanceAsset.locked);

                break;
            }
        }

        return statement;
    }

    async #getSymbolLastTick (symbol: string): Promise<MidaTick> {
        const lastTick: MidaTick | undefined = this.#lastTicks.get(symbol);

        if (lastTick) {
            return lastTick;
        }

        const lastPlainTick: GenericObject = (await this.#binanceConnection.allBookTickers())[symbol];

        return new MidaTick({
            ask: decimal(lastPlainTick.askPrice),
            bid: decimal(lastPlainTick.bidPrice),
            date: date(),
            movement: MidaTickMovement.BID_ASK,
            symbol,
        });
    }

    public override async getSymbolBid (symbol: string): Promise<MidaDecimal> {
        return (await this.#getSymbolLastTick(symbol)).bid;
    }

    public override async getSymbolAsk (symbol: string): Promise<MidaDecimal> {
        return (await this.#getSymbolLastTick(symbol)).ask;
    }

    public override async getSymbolAverage (symbol: string): Promise<MidaDecimal> {
        const response: AvgPriceResult = await this.#binanceConnection.avgPrice({ symbol, }) as AvgPriceResult;

        return decimal(response.price);
    }

    public override async getSymbolPeriods (symbol: string, timeframe: number): Promise<MidaPeriod[]> {
        const periods: MidaPeriod[] = [];
        const plainPeriods: GenericObject[] = await this.#binanceConnection.candles(<CandlesOptions> {
            symbol,
            interval: normalizeTimeframeForBinance(timeframe),
        });

        for (const plainPeriod of plainPeriods) {
            periods.push(new MidaPeriod({
                symbol,
                close: decimal(plainPeriod.close),
                high: decimal(plainPeriod.high),
                low: decimal(plainPeriod.low),
                open: decimal(plainPeriod.open),
                quotationPrice: MidaQuotationPrice.BID,
                startDate: date(plainPeriod.openTime),
                timeframe,
                isClosed: true,
                volume: decimal(plainPeriod.volume),
            }));
        }

        // Order from oldest to newest
        periods.sort((left, right): number => left.startDate.timestamp - right.startDate.timestamp);

        return periods;
    }

    public override async getSymbols (): Promise<string[]> {
        return [ ...this.#symbols.keys(), ];
    }

    public override async getSymbol (symbol: string): Promise<MidaSymbol | undefined> {
        return this.#symbols.get(symbol);
    }

    public override async watchSymbolTicks (symbol: string): Promise<void> {
        if (this.#tickListeners.has(symbol)) {
            return;
        }

        this.#binanceConnection.ws.customSubStream(`${symbol.toLowerCase()}@bookTicker`, (plainTick: GenericObject) => this.#onTick(plainTick));
        this.#tickListeners.set(symbol, true);
    }

    public override async watchSymbolPeriods (symbol: string, timeframe: number): Promise<void> {
        const listenedTimeframes: number[] = this.#periodListeners.get(symbol) ?? [];

        if (listenedTimeframes.includes(timeframe)) {
            return;
        }

        // eslint-disable-next-line max-len
        this.#binanceConnection.ws.candles(symbol, normalizeTimeframeForBinance(timeframe), (plainPeriod: GenericObject) => this.#onPeriodUpdate(plainPeriod));
        listenedTimeframes.push(timeframe);
        this.#periodListeners.set(symbol, listenedTimeframes);
    }

    public override async getOpenPositions (): Promise<MidaPosition[]> {
        return [];
    }

    public override async isSymbolMarketOpen (symbol: string): Promise<boolean> {
        return true;
    }

    public override async getCryptoAssetDepositAddress (asset: string, net: string): Promise<string> {
        return (await this.#binanceConnection.depositAddress({ coin: asset, network: net, })).address;
    }

    // https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#individual-symbol-book-ticker-streams
    #onTick (plainTick: GenericObject): void {
        const symbol: string = plainTick.s;
        const bid: MidaDecimal = decimal(plainTick.b);
        const ask: MidaDecimal = decimal(plainTick.a);
        const previousTick: MidaTick | undefined = this.#lastTicks.get(symbol);
        const movement: MidaTickMovement | undefined = ((): MidaTickMovement | undefined => {
            const currentBidIsEqualToPrevious: boolean = previousTick?.bid.equals(bid) ?? false;
            const currentAskIsEqualToPrevious: boolean = previousTick?.ask.equals(ask) ?? false;

            if (currentBidIsEqualToPrevious && currentAskIsEqualToPrevious) {
                return undefined;
            }

            if (currentAskIsEqualToPrevious) {
                return MidaTickMovement.BID;
            }

            if (currentBidIsEqualToPrevious) {
                return MidaTickMovement.ASK;
            }

            return MidaTickMovement.BID_ASK;
        })();

        if (!movement) {
            return;
        }

        const tick: MidaTick = new MidaTick({
            bid: decimal(plainTick.b),
            ask: decimal(plainTick.a),
            date: date(),
            movement,
            symbol,
        });

        this.#lastTicks.set(symbol, tick);

        if (this.#tickListeners.has(symbol)) {
            this.notifyListeners("tick", { tick, });
        }
    }

    #onPeriodUpdate (plainPeriod: GenericObject): void {
        const symbol: string = plainPeriod.symbol;
        const timeframe: number = normalizeTimeframe(plainPeriod.interval);

        if (!(this.#periodListeners.get(symbol) ?? []).includes(timeframe)) {
            return;
        }

        const period: MidaPeriod = new MidaPeriod({
            symbol,
            close: decimal(plainPeriod.close),
            high: decimal(plainPeriod.high),
            low: decimal(plainPeriod.low),
            open: decimal(plainPeriod.open),
            quotationPrice: MidaQuotationPrice.BID,
            startDate: date(plainPeriod.openTime),
            timeframe,
            isClosed: plainPeriod.isFinal === true,
            volume: decimal(plainPeriod.volume),
        });

        this.notifyListeners("period-update", { period, });
    }

    async #preloadSymbols (): Promise<void> {
        const binanceSymbols: BinanceSymbol[] = (await this.#binanceConnection.exchangeInfo()).symbols;

        this.#symbols.clear();

        for (const binanceSymbol of binanceSymbols) {
            const volumeFilter: GenericObject | undefined = getPlainSymbolFilterByType(binanceSymbol, "LOT_SIZE");

            this.#symbols.set(binanceSymbol.symbol, new MidaSymbol({
                baseAsset: binanceSymbol.baseAsset,
                tradingAccount: this,
                description: "",
                leverage: decimal(0),
                lotUnits: decimal(1),
                maxLots: decimal(volumeFilter?.maxQty ?? -1),
                minLots: decimal(volumeFilter?.minQty ?? -1),
                pipPosition: -1,
                quoteAsset: binanceSymbol.quoteAsset,
                symbol: binanceSymbol.symbol,
            }));
        }
    }

    #onNewOrder (descriptor: GenericObject): void {

    }

    public override async getSymbolTradeStatus (symbol: string): Promise<MidaSymbolTradeStatus> {
        return MidaSymbolTradeStatus.ENABLED;
    }

    public override async getDate (): Promise<MidaDate> {
        return date();
    }

    async #configureListeners (): Promise<void> {
        await this.#binanceConnection.ws.user((update: GenericObject): void => {
            if (update.eventType === "executionReport" && update.orderId && update.orderStatus.toUpperCase() === "NEW") {
                this.#onNewOrder(update);
            }

            this.#binanceEmitter.notifyListeners("update", { update, });
        });
    }
}

export function getPlainSymbolFilterByType (plainSymbol: BinanceSymbol, type: string): GenericObject | undefined {
    for (const filter of plainSymbol.filters) {
        if (filter.filterType === type) {
            return filter;
        }
    }

    return undefined;
}

export function normalizeTimeframeForBinance (timeframe: number): string {
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
        case 7200: {
            return "2h";
        }
        case 14400: {
            return "4h";
        }
        case 21600: {
            return "6h";
        }
        case 43200: {
            return "12h";
        }
        case 86400: {
            return "1d";
        }
        case 259200: {
          return "3d";
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

export function normalizeTimeframe (timeframe: string): number {
    switch (timeframe) {
        case "1m": {
            return 60;
        }
        case "3m": {
            return 180;
        }
        case "5m": {
            return 300;
        }
        case "15m": {
            return 900;
        }
        case "30m": {
            return 1800;
        }
        case "1h": {
            return 3600;
        }
        case "2h": {
            return 7200;
        }
        case "4h": {
          return 14400;
        }
        case "6h": {
          return 21600;
        }
        case "12h": {
            return 43200;
        }
        case "1d": {
            return 86400;
        }
        case "3d": {
          return 259200;
        }
        case "1w": {
            return 604800;
        }
        case "1M": {
            return 2592000;
        }
        default: {
            throw new Error("Unknown timeframe");
        }
    }
}

export function normalizeTimeInForceForBinance (timeInForce: MidaOrderTimeInForce): string {
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

export function normalizeTimeInForce (timeInForce: string): MidaOrderTimeInForce {
    switch (timeInForce.toUpperCase()) {
        case "GTC": {
            return MidaOrderTimeInForce.GOOD_TILL_CANCEL;
        }
        case "FOK": {
            return MidaOrderTimeInForce.FILL_OR_KILL;
        }
        case "IOC": {
            return MidaOrderTimeInForce.IMMEDIATE_OR_CANCEL;
        }
        default: {
            throw new Error(`Unknown order time in force ${timeInForce}`);
        }
    }
}
