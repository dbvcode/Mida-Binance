import {
    MidaDate,
    MidaEmitter,
    MidaOrder,
    MidaOrderRejection,
    MidaOrderStatus,
    GenericObject,
} from "@reiryoku/mida";
import { Binance } from "binance-api-node";
import { BinanceSpotOrderParameters } from "#platforms/binance-spot/orders/BinanceSpotOrderParameters";

export class BinanceSpotOrder extends MidaOrder {
    readonly #binanceConnection: Binance;
    readonly #binanceEmitter: MidaEmitter;

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

    public override async cancel (): Promise<void> {
        if (this.status === MidaOrderStatus.PENDING) {
            await this.#binanceConnection.cancelOrder({
                symbol: this.symbol,
                orderId: Number(this.id),
            });
        }
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
        this.#binanceEmitter.on("update", (descriptor: GenericObject): void => {
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
