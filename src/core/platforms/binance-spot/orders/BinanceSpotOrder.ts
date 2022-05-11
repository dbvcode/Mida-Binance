import {
    GenericObject,
    MidaDate,
    MidaEmitter,
    MidaEvent,
    MidaOrder,
    MidaOrderDirection,
    MidaOrderDirectives,
    MidaOrderRejection,
    MidaOrderStatus,
    MidaTradeDirection,
    MidaTradePurpose,
    MidaTradeStatus,
} from "@reiryoku/mida";
import { Binance, NewOrderSpot } from "binance-api-node";
import { BinanceSpotOrderParameters } from "#platforms/binance-spot/orders/BinanceSpotOrderParameters";
import { BinanceSpotAccount, normalizeTimeInForceForBinance } from "#platforms/binance-spot/BinanceSpotAccount";
import { BinanceSpotTrade } from "#platforms/binance-spot/trades/BinanceSpotTrade";

export class BinanceSpotOrder extends MidaOrder {
    readonly #binanceConnection: Binance;
    readonly #binanceEmitter: MidaEmitter;
    readonly #directives?: MidaOrderDirectives;

    public constructor ({
        id,
        tradingAccount,
        symbol,
        requestedVolume,
        direction,
        purpose,
        limitPrice,
        stopPrice,
        status,
        creationDate,
        lastUpdateDate,
        timeInForce,
        trades,
        rejection,
        isStopOut,
        binanceConnection,
        binanceEmitter,
        directives,
    }: BinanceSpotOrderParameters) {
        super({
            id,
            tradingAccount,
            symbol,
            requestedVolume,
            direction,
            purpose,
            limitPrice,
            stopPrice,
            status,
            creationDate,
            lastUpdateDate,
            timeInForce,
            trades,
            rejection,
            isStopOut,
        });

        this.#binanceConnection = binanceConnection;
        this.#binanceEmitter = binanceEmitter;
        this.#directives = directives;

        // Listen events only if the order is not in a final state
        if (
            status !== MidaOrderStatus.CANCELLED &&
            status !== MidaOrderStatus.REJECTED &&
            status !== MidaOrderStatus.EXPIRED &&
            status !== MidaOrderStatus.EXECUTED
        ) {
            this.#configureListeners();
        }
    }

    get #binanceSpotAccount (): BinanceSpotAccount {
        return this.tradingAccount as BinanceSpotAccount;
    }

    public override async cancel (): Promise<void> {
        if (this.status !== MidaOrderStatus.PENDING) {
            return;
        }

        try {
            await this.#binanceConnection.cancelOrder({ symbol: this.symbol, orderId: Number(this.id), });

            this.lastUpdateDate = new MidaDate();
            this.onStatusChange(MidaOrderStatus.CANCELLED);
        }
        catch (error) {
            console.log("Error while trying to cancel Binance Spot pending order");
            console.log(error);

            return;
        }
    }

    public send (): void {
        const directives = this.#directives;

        if (!directives) {
            return;
        }

        if (directives.positionId || !directives.symbol) {
            this.onStatusChange(MidaOrderStatus.REJECTED);
            this.rejection = MidaOrderRejection.UNKNOWN;

            return;
        }

        const symbol: string = directives.symbol;
        const direction: MidaOrderDirection = directives.direction;
        const volume: number = directives.volume;

        const plainDirectives: GenericObject = {
            symbol,
            side: direction === MidaOrderDirection.BUY ? "BUY" : "SELL",
            quantity: volume.toString(),
        };

        if (directives.limit) {
            plainDirectives.price = directives.limit.toString();
            plainDirectives.type = "LIMIT";
        }
        else {
            plainDirectives.type = "MARKET";
        }

        if (directives.timeInForce) {
            plainDirectives.timeInForce = normalizeTimeInForceForBinance(directives.timeInForce);
        }

        this.#binanceConnection.order(<NewOrderSpot>plainDirectives).then((plainOrder: GenericObject) => {
            console.log(plainOrder);
            this.#onResponse(plainOrder);
        }).catch((plainError: GenericObject) => {
            this.#onResponseReject(plainError);
        });
    }

    #onResponse (plainOrder: GenericObject): void {
        const orderId: string = plainOrder.orderId.toString();
        const lastUpdateDate: MidaDate = new MidaDate(Number(plainOrder.transactTime));
        let status: MidaOrderStatus;

        this.id = orderId;
        this.creationDate = lastUpdateDate;
        this.lastUpdateDate = lastUpdateDate;

        switch (plainOrder.status.toUpperCase()) {
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaOrderStatus.EXECUTED;

                break;
            }
            case "NEW": {
                status = MidaOrderStatus.PENDING;

                break;
            }
            default: {
                console.log(plainOrder);

                throw new Error("Unknonw Binance Spot order response");
            }
        }

        for (const plainTrade of plainOrder?.fills ?? []) {
            this.onTrade(new BinanceSpotTrade({
                commission: Number(plainTrade.commission),
                commissionAsset: plainTrade.commissionAsset,
                direction: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradeDirection.BUY : MidaTradeDirection.SELL,
                executionDate: lastUpdateDate,
                executionPrice: Number(plainTrade.price),
                id: plainTrade.tradeId.toString(),
                orderId,
                positionId: "",
                purpose: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradePurpose.OPEN : MidaTradePurpose.CLOSE,
                status: MidaTradeStatus.EXECUTED,
                symbol: this.#directives?.symbol as string,
                tradingAccount: this.tradingAccount,
                volume: Number(plainTrade.qty),
            }));
        }

        this.onStatusChange(status);
    }

    #onResponseReject (plainError: GenericObject): void {
        const currentDate: MidaDate = new MidaDate();

        this.creationDate = currentDate;
        this.lastUpdateDate = currentDate;

        // Error codes reference: https://github.com/binance/binance-spot-api-docs/blob/master/errors.md
        switch (Number(plainError.code)) {
            case -2010: {
                this.rejection = MidaOrderRejection.NOT_ENOUGH_MONEY;

                break;
            }
            case -1121: {
                this.rejection = MidaOrderRejection.SYMBOL_NOT_FOUND;

                break;
            }
            default: {
                this.rejection = MidaOrderRejection.UNKNOWN;

                console.log("Unknown Binance Spot API order rejection reason");
                console.log(plainError);
                console.log("This is a warning, your order has just been rejected");
                console.log("Consult the Binance API documentation to find a complete explanation");
            }
        }

        this.onStatusChange(MidaOrderStatus.REJECTED);
    }

    #onUpdate (descriptor: GenericObject): void {
        const lastUpdateTimestamp: number = Number(descriptor.E);
        const lastUpdateDate: MidaDate = new MidaDate(lastUpdateTimestamp);
        const binanceStatus: string = descriptor.X.toUpperCase();
        let status: MidaOrderStatus = MidaOrderStatus.REQUESTED;

        switch (binanceStatus) {
            case "NEW": {
                if (descriptor.o.toUpperCase() !== "MARKET") {
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
                this.rejection = MidaOrderRejection.UNKNOWN;

                break;
            }
        }

        if (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateDate.timestamp) {
            this.lastUpdateDate = lastUpdateDate;
        }

        this.onStatusChange(status);
    }

    #configureListeners (): void {
        this.#binanceEmitter.on("update", (event: MidaEvent): void => {
            console.log(event.descriptor);
            const descriptor = event.descriptor.update;
            const eventType: string = descriptor.e;

            if (eventType !== "executionReport") {
                return;
            }

            const orderId: string = descriptor.i?.toString();

            if (orderId !== this.id) {
                return;
            }

            this.#onUpdate(descriptor);
        });
    }
}
