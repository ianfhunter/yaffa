// Categorization rule engine functionality
import Engine from 'json-rules-engine';

const engine = new Engine();

function getField(fact, candidates) {
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(fact, key) && fact[key] !== undefined && fact[key] !== null && fact[key] !== '') {
            return fact[key];
        }
    }

    return '';
}

function getSelectedAccount() {
    return {
        id: $('#account').val(),
        name: $('#account option:selected').text(),
    };
}

function getActiveCurrencyIsoCode() {
    return window.YAFFA?.baseCurrency?.iso_code || '';
}

function parseAmount(rawAmount) {
    if (!rawAmount) {
        return undefined;
    }

    const currencyCode = getActiveCurrencyIsoCode();
    const escapedCurrencyCode = currencyCode ? currencyCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';

    // Accept values such as:
    // -1 234,56 HUF | -1234.56 USD | 1234,56 | 1,234.56
    const amountRegex = new RegExp(
        `^\\s*([+-])?\\s*((?:\\d{1,3}(?:[\\s,.]\\d{3})*|\\d+)(?:[,.]\\d+)?)\\s*(?:${escapedCurrencyCode})?\\s*$`,
        'i'
    );

    const match = amountRegex.exec(rawAmount);
    if (!match) {
        return undefined;
    }

    const sign = match[1] === '-' ? -1 : 1;
    let numericPart = match[2].replace(/\s/g, '');

    const lastComma = numericPart.lastIndexOf(',');
    const lastDot = numericPart.lastIndexOf('.');

    if (lastComma > -1 && lastDot > -1) {
        if (lastComma > lastDot) {
            numericPart = numericPart.replace(/\./g, '').replace(',', '.');
        } else {
            numericPart = numericPart.replace(/,/g, '');
        }
    } else if (lastComma > -1) {
        numericPart = numericPart.replace(/\./g, '').replace(',', '.');
    }

    const parsedValue = Number.parseFloat(numericPart);
    if (Number.isNaN(parsedValue)) {
        return undefined;
    }

    return Math.abs(sign * parsedValue);
}

function parseDate(fact) {
    const rawDate = getField(fact, ['Value date', 'Booking date', 'Date', 'Transaction date']);
    if (!rawDate) {
        return undefined;
    }

    const isoLike = /(\d{4})[-.](\d{2})[-.](\d{2})/.exec(rawDate);
    if (isoLike) {
        return new Date(`${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`);
    }

    const euLike = /(\d{2})[-.\/](\d{2})[-.\/](\d{4})/.exec(rawDate);
    if (euLike) {
        return new Date(`${euLike[3]}-${euLike[2]}-${euLike[1]}`);
    }

    return undefined;
}

function findPayee(fact, fallbackPayeeName = 'Other') {
    const description = getField(fact, ['Description', 'Details', 'Payee', 'Counterparty']);

    for (const payee of window.payees) {
        const regex = new RegExp(payee.name, 'i');
        if (regex.test(description)) {
            return payee;
        }
    }

    for (const payee of window.payees.filter(payee => payee.alias)) {
        for (const alias of payee.alias.split(/\r?\n/)) {
            const regex = new RegExp(alias, 'i');
            if (regex.test(description)) {
                return payee;
            }
        }
    }

    return window.payees.find(payee => payee.name === fallbackPayeeName);
}

const operatorMatchRegex = function (factValue, regexString) {
    if (factValue === undefined || factValue === null) return false;

    const regex = new RegExp(regexString, 'i');

    return regex.test(String(factValue));
};
engine.addOperator('matchesRegex', operatorMatchRegex);

// Generic outgoing transaction rule
engine.addRule({
    conditions: {
        all: [
            {
                fact: 'Amount',
                operator: 'matchesRegex',
                value: '^\\s*-'
            }
        ]
    },
    event: {
        type: 'Outgoing transfer',
        params: {
            processingRules: [
                {
                    transactionField: 'date',
                    customFunction: parseDate,
                },
                {
                    transactionField: 'transaction_config_type',
                    customValue: 'standard',
                },
                {
                    transactionField: 'transaction_type_id',
                    customValue: 1,
                },
                {
                    transactionField: 'transaction_type.name',
                    customValue: 'withdrawal',
                },
                {
                    transactionField: 'transaction_type.amount_multiplier',
                    customValue: 1,
                },
                {
                    transactionField: 'config.amount_from',
                    customFunction: function (fact) {
                        return parseAmount(getField(fact, ['Amount']));
                    }
                },
                {
                    transactionField: 'config.amount_to',
                    customFunction: function (fact) {
                        return parseAmount(getField(fact, ['Amount']));
                    }
                },
                {
                    transactionField: 'config.account_to',
                    customFunction: findPayee,
                },
                {
                    transactionField: 'config.account_from',
                    customFunction: getSelectedAccount,
                },
                {
                    transactionField: 'comment',
                    customFunction: function (fact, transaction) {
                        if (transaction.config.account_to?.name === 'Other') {
                            return getField(fact, ['Description', 'Details', 'Payee', 'Counterparty']);
                        }
                    }
                }
            ]
        }
    }
});

// Generic incoming transaction rule
engine.addRule({
    conditions: {
        all: [
            {
                fact: 'Amount',
                operator: 'matchesRegex',
                value: '^\\s*(?!-)'
            }
        ]
    },
    event: {
        type: 'Incoming transfer',
        params: {
            processingRules: [
                {
                    transactionField: 'date',
                    customFunction: parseDate,
                },
                {
                    transactionField: 'transaction_config_type',
                    customValue: 'standard',
                },
                {
                    transactionField: 'transaction_type_id',
                    customValue: 2,
                },
                {
                    transactionField: 'transaction_type.name',
                    customValue: 'deposit',
                },
                {
                    transactionField: 'transaction_type.amount_multiplier',
                    customValue: 1,
                },
                {
                    transactionField: 'config.amount_from',
                    customFunction: function (fact) {
                        return parseAmount(getField(fact, ['Amount']));
                    }
                },
                {
                    transactionField: 'config.amount_to',
                    customFunction: function (fact) {
                        return parseAmount(getField(fact, ['Amount']));
                    }
                },
                {
                    transactionField: 'config.account_from',
                    customFunction: findPayee,
                },
                {
                    transactionField: 'config.account_to',
                    customFunction: getSelectedAccount,
                },
                {
                    transactionField: 'comment',
                    customFunction: function (fact, transaction) {
                        if (transaction.config.account_from?.name === 'Other') {
                            return getField(fact, ['Description', 'Details', 'Payee', 'Counterparty']);
                        }
                    }
                }
            ]
        }
    }
});

export default engine;
