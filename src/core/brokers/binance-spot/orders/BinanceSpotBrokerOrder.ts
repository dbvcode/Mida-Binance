import { Binance } from "binance-api-node";
import {
    MidaDate,
    MidaBrokerOrder,
    MidaBrokerOrderStatus,
    GenericObject,
} from "@reiryoku/mida";
import { BinanceSpotBrokerOrderParameters } from "#brokers/binance-spot/orders/BinanceSpotBrokerOrderParameters";
import { BinanceSpotBrokerAccount } from "#brokers/binance-spot/BinanceSpotBrokerAccount";

export class BinanceSpotBrokerOrder extends MidaBrokerOrder {
    readonly #binanceConnection: Binance;
    #closeSocketConnection?: any;

    public constructor ({
        id,
        brokerAccount,
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
        deals,
        position,
        rejectionType,
        isStopOut,
        binanceConnection,
    }: BinanceSpotBrokerOrderParameters) {
        super({
            id,
            brokerAccount,
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
            deals,
            position,
            rejectionType,
            isStopOut,
        });

        this.#binanceConnection = binanceConnection;
        this.#closeSocketConnection = undefined;

        // Listen events only if the order is not in a final state
        if (
            status !== MidaBrokerOrderStatus.CANCELLED &&
            status !== MidaBrokerOrderStatus.REJECTED &&
            status !== MidaBrokerOrderStatus.EXPIRED &&
            status !== MidaBrokerOrderStatus.EXECUTED
        ) {
            this.#configureListeners();
        }
    }

    public override async cancel (): Promise<void> {
        if (this.status === MidaBrokerOrderStatus.PENDING) {
            await this.#binanceConnection.cancelOrder({
                symbol: this.symbol,
                orderId: Number(this.id),
            });
        }
    }

    get #binanceSpotBrokerAccount (): BinanceSpotBrokerAccount {
        // @ts-ignore
        return this.brokerAccount as BinanceSpotBrokerAccount;
    }

    #onUpdate (descriptor: GenericObject): void {
        const lastUpdateDate: MidaDate = new MidaDate(Number(descriptor.E));
        let status: MidaBrokerOrderStatus = MidaBrokerOrderStatus.REQUESTED;

        switch (descriptor.X.toUpperCase()) {
            case "NEW": {
                if (descriptor.o.toUpperCase() !== "MARKET") {
                    status = MidaBrokerOrderStatus.PENDING;
                }

                break;
            }
            case "PARTIALLY_FILLED":
            case "FILLED": {
                status = MidaBrokerOrderStatus.EXECUTED;

                this.#closeSocketConnection();

                break;
            }
            case "PENDING_CANCEL":
            case "CANCELED": {
                status = MidaBrokerOrderStatus.CANCELLED;

                this.#closeSocketConnection();

                break;
            }
            case "EXPIRED": {
                status = MidaBrokerOrderStatus.EXPIRED;

                this.#closeSocketConnection();

                break;
            }
            case "REJECTED": {
                status = MidaBrokerOrderStatus.REJECTED;

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
