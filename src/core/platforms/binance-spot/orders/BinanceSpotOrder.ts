import {
    GenericObject,
    MidaDate,
    MidaOrder,
    MidaOrderStatus,
} from "@reiryoku/mida";
import { Binance } from "binance-api-node";
import { BinanceSpotOrderParameters } from "#platforms/binance-spot/orders/BinanceSpotOrderParameters";

export class BinanceSpotOrder extends MidaOrder {
    readonly #binanceConnection: Binance;
    #closeSocketConnection?: any;

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
        this.#closeSocketConnection = undefined;

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
        const lastUpdateDate: MidaDate = new MidaDate(Number(descriptor.E));
        let status: MidaOrderStatus = MidaOrderStatus.REQUESTED;

        switch (descriptor.X.toUpperCase()) {
            case "NEW": {
                if (descriptor.o.toUpperCase() !== "MARKET") {
                    status = MidaOrderStatus.PENDING;
                }

                break;
            }
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaOrderStatus.EXECUTED;

                this.#closeSocketConnection();

                break;
            }
            case "PENDING_CANCEL":
            case "CANCELED": {
                status = MidaOrderStatus.CANCELLED;

                this.#closeSocketConnection();

                break;
            }
            case "EXPIRED": {
                status = MidaOrderStatus.EXPIRED;

                this.#closeSocketConnection();

                break;
            }
            case "REJECTED": {
                status = MidaOrderStatus.REJECTED;

                this.#closeSocketConnection();

                break;
            }
        }

        if (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateDate.timestamp) {
            this.lastUpdateDate = lastUpdateDate;
        }

        if (this.status !== status) {
            this.onStatusChange(status);
        }
    }

    #configureListeners (): void {
        this.#closeSocketConnection = this.#binanceConnection.ws.user((descriptor: GenericObject): void => {
            if (descriptor.e === "executionReport" && descriptor.i.toString() === this.id) {
                this.#onUpdate(descriptor);
            }
        });
    }
}
