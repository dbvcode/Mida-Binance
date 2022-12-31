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
    decimal,
    GenericObject,
    MidaDate, MidaDecimal,
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
import { Binance, NewFuturesOrder, } from "binance-api-node";
import { BinanceFuturesAccount, normalizeTimeInForceForBinance, } from "../BinanceFuturesAccount";
import { BinanceFuturesTrade, } from "../trades/BinanceFuturesTrade";
import { BinanceFuturesOrderParameters, } from "./BinanceFuturesOrderParameters";

export class BinanceFuturesOrder extends MidaOrder {
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
    }: BinanceFuturesOrderParameters) {
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

    get #binanceFuturesAccount (): BinanceFuturesAccount {
        return this.tradingAccount as BinanceFuturesAccount;
    }

    public override async cancel (): Promise<void> {
        if (this.status !== MidaOrderStatus.PENDING) {
            return;
        }

        try {
            await this.#binanceConnection.futuresCancelOrder({ symbol: this.symbol, orderId: Number(this.id), });

            this.lastUpdateDate = new MidaDate();
            this.onStatusChange(MidaOrderStatus.CANCELLED);
        }
        catch (error) {
            console.log("Error while trying to cancel Binance Futures pending order");
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
        const volume: MidaDecimal = decimal(directives.volume);

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

        this.#binanceConnection.futuresOrder(<NewFuturesOrder>plainDirectives).then((plainOrder: GenericObject) => {
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

                throw new Error("Unknonw Binance Futures order response");
            }
        }

        for (const plainTrade of plainOrder?.fills ?? []) {
            this.onTrade(new BinanceFuturesTrade({
                commission: decimal(plainTrade.commission),
                commissionAsset: plainTrade.commissionAsset,
                direction: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradeDirection.BUY : MidaTradeDirection.SELL,
                executionDate: lastUpdateDate,
                executionPrice: decimal(plainTrade.price),
                id: plainTrade.tradeId.toString(),
                orderId,
                positionId: "",
                purpose: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradePurpose.OPEN : MidaTradePurpose.CLOSE,
                status: MidaTradeStatus.EXECUTED,
                symbol: this.#directives?.symbol as string,
                tradingAccount: this.tradingAccount,
                volume: decimal(plainTrade.qty),
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

                console.log("Unknown Binance Futures API order rejection reason");
                console.log(plainError);
                console.log("This is a warning, your order has just been rejected");
                console.log("Consult the Binance API documentation to find a complete explanation");
            }
        }

        this.onStatusChange(MidaOrderStatus.REJECTED);
    }

    // eslint-disable-next-line max-lines-per-function
    #onUpdate (descriptor: GenericObject): void {
        const orderId: string = descriptor.orderId.toString();
        const lastUpdateDate: MidaDate = new MidaDate();
        const plainStatus: string = descriptor.orderStatus.toUpperCase();
        let status: MidaOrderStatus = MidaOrderStatus.REQUESTED;

        if (!this.id) {
            this.id = orderId;
        }

        if (!this.lastUpdateDate || this.lastUpdateDate.timestamp !== lastUpdateDate.timestamp) {
            this.lastUpdateDate = lastUpdateDate;
        }

        switch (plainStatus) {
            case "NEW": {
                if (descriptor.orderType.toUpperCase() !== "MARKET") {
                    status = MidaOrderStatus.PENDING;
                }

                break;
            }
            case "PARTIALLY_FILLED":
            case "FILLED": {
                if (descriptor.isOrderWorking === false) {
                    status = MidaOrderStatus.EXECUTED;
                }

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

                console.log("Unknonw Binance Futures order reject reason");
                console.log(descriptor.orderRejectReason);

                break;
            }
        }

        if (descriptor.executionType.toUpperCase() === "TRADE") {
            this.onTrade(new BinanceFuturesTrade({
                commission: decimal(descriptor.commission),
                commissionAsset: descriptor.commissionAsset,
                direction: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradeDirection.BUY : MidaTradeDirection.SELL,
                executionDate: lastUpdateDate,
                executionPrice: decimal(descriptor.priceLastTrade),
                id: descriptor.tradeId.toString(),
                orderId,
                positionId: "",
                purpose: this.#directives?.direction === MidaOrderDirection.BUY ? MidaTradePurpose.OPEN : MidaTradePurpose.CLOSE,
                status: MidaTradeStatus.EXECUTED,
                symbol: this.#directives?.symbol as string,
                tradingAccount: this.tradingAccount,
                volume: decimal(descriptor.lastTradeQuantity),
            }));
        }

        if (this.status !== status) {
            this.onStatusChange(status);
        }
    }

    #configureListeners (): void {
        this.#binanceEmitter.on("update", (event: MidaEvent): void => {
            const descriptor = event.descriptor;

            if (descriptor.eventType !== "executionReport") {
                return;
            }

            if (!this.id || descriptor?.orderId.toString() !== this.id) {
                return;
            }

            this.#onUpdate(descriptor);
        });
    }
}
