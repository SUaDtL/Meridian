const million = 1_000_000n;
const maxMoney = 999_999_999_999_999n;

export type PricePolicy = {
  version: string;
  currency: 'USD';
  unit: 'microdollar';
  maxInputTokens: number;
  maxOutputTokens: number;
  inputMicrousdPerMillionTokens: string;
  outputMicrousdPerMillionTokens: string;
  fixedUpperBoundMicrousd: string;
  maxChargeMicrousd: string;
  displayLabel: string;
};

export type ChargeAcknowledgment = {
  acknowledgeBillableRequest: boolean;
  pricePolicyVersion: string;
  acknowledgedMaxChargeMicrousd: string;
};

function parseMoney(value: string): bigint {
  if (typeof value !== 'string' || /^(?:0|[1-9][0-9]{0,14})$/.exec(value)?.[0] !== value) {
    throw new RangeError('Invalid microdollar amount');
  }
  return BigInt(value);
}

function tokenLimit(value: number, maximum: number): bigint {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid token limit');
  return BigInt(value);
}

export function priceCeiling(policy: PricePolicy): bigint {
  if (typeof policy.version !== 'string' || !policy.version.trim() || policy.version.length > 80 ||
      typeof policy.displayLabel !== 'string' || !policy.displayLabel.trim() || policy.displayLabel.length > 200 ||
      policy.currency !== 'USD' || policy.unit !== 'microdollar') {
    throw new RangeError('Invalid price policy');
  }
  const input = tokenLimit(policy.maxInputTokens, 131_072) * parseMoney(policy.inputMicrousdPerMillionTokens);
  const output = tokenLimit(policy.maxOutputTokens, 16_384) * parseMoney(policy.outputMicrousdPerMillionTokens);
  const maximum = (input + output + million - 1n) / million + parseMoney(policy.fixedUpperBoundMicrousd);
  if (maximum > maxMoney || parseMoney(policy.maxChargeMicrousd) !== maximum) {
    throw new RangeError('Inconsistent maximum charge');
  }
  return maximum;
}

export function agreedCharge(
  policy: PricePolicy,
  acknowledgment: ChargeAcknowledgment,
): { code: 'ACCEPTED'; reserveMicrousd: bigint } | { code: 'INVALID_REQUEST' | 'PRICE_POLICY_CHANGED' } {
  if (acknowledgment.acknowledgeBillableRequest !== true) return { code: 'INVALID_REQUEST' };
  const reserveMicrousd = priceCeiling(policy);
  if (acknowledgment.pricePolicyVersion !== policy.version ||
      acknowledgment.acknowledgedMaxChargeMicrousd !== reserveMicrousd.toString()) {
    return { code: 'PRICE_POLICY_CHANGED' };
  }
  return { code: 'ACCEPTED', reserveMicrousd };
}

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  overheadMicrousd: string;
};

export function knownCharge(policy: PricePolicy, usage: ProviderUsage): bigint {
  const ceiling = priceCeiling(policy);
  const checkedTokens = (count: number, cap: number) => {
    if (!Number.isInteger(count) || count < 0 || count > cap) throw new RangeError('Usage exceeds the priced limits.');
    return BigInt(count);
  };
  const input = checkedTokens(usage.inputTokens, policy.maxInputTokens) * parseMoney(policy.inputMicrousdPerMillionTokens);
  const output = checkedTokens(usage.outputTokens, policy.maxOutputTokens) * parseMoney(policy.outputMicrousdPerMillionTokens);
  const overhead = parseMoney(usage.overheadMicrousd);
  const charge = (input + output + million - 1n) / million + overhead;
  if (overhead > parseMoney(policy.fixedUpperBoundMicrousd) || charge > ceiling) throw new RangeError('Usage exceeds the priced limits.');
  return charge;
}
