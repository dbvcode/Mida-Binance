import { GenericObject, MidaBrokerOrder, MidaBrokerOrderStatus, MidaDate } from "@reiryoku/mida";
import { BinanceSpotBrokerOrderParameters } from "#brokers/binance-spot/orders/BinanceSpotBrokerOrderParameters";

export class BinanceSpotBrokerOrder extends MidaBrokerOrder {
    readonly #binanceHandler: GenericObject;

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
        binanceHandler,
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

        this.#binanceHandler = binanceHandler;

        this.#configureListeners();
    }

    public override async cancel (): Promise<void> {
        if (this.status === MidaBrokerOrderStatus.PENDING) {
            await this.#binanceHandler.cancel(this.symbol, this.id);
        }
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
        }

        if (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateDate.timestamp) {
            this.lastUpdateDate = lastUpdateDate;
        }

        if (status !== this.status) {
            this.onStatusChange(status);
        }
    }

    #configureListeners (): void {
        const updateHandler: Function = (descriptor: GenericObject): void => {
            if (descriptor.e === "executionReport" && descriptor.i.toString() === this.id) {
                this.#onUpdate(descriptor);
            }
        };

        this.#binanceHandler.websockets.userData(updateHandler, updateHandler);
    }
}
