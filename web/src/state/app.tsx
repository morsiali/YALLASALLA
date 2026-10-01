import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';
import {
  defaultConstraints,
  toApiConstraints,
  type Area,
  type BasketDraft,
  type Constraints,
  type Priced,
} from '../lib/types';

interface Config {
  providers: {
    otp: { mode: string };
    payments: { mode: string; name: string; cod: boolean };
    ai: { name: string };
    transcription: { mode: string };
  };
  loyalty: {
    earnPointsPerAed: number;
    holdDays: number;
    pointValueMinor: number;
    minRedeemPoints: number;
    maxRedeemPctOfSubtotal: number;
    expiryDays: number;
    dailyEarnCapPoints: number;
  };
  sandboxCardTokens: string[];
  autoSubstitutionMaxIncreasePct: number;
}
interface AppCtx {
  config: Config | null;
  areas: Area[];
  area: Area | null;
  form: Constraints;
  setForm: (f: Constraints | ((p: Constraints) => Constraints)) => void;
  basket: BasketDraft | null;
  setBasket: (b: BasketDraft | null) => void;
  priced: Priced | null;
  pricing: boolean;
  priceError: string | null;
  setQty: (productId: string, qty: number) => void;
  replaceItem: (fromId: string, toId: string) => void;
  addItem: (productId: string, qty?: number) => void;
  setArea: (id: string | null) => void;
  clearBasket: () => void;
  areaPickerOpen: boolean;
  setAreaPickerOpen: (o: boolean) => void;
  online: boolean;
}
const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

const KEY = 'yalasala.draft.v1';
interface Persisted {
  form: Constraints;
  basket: BasketDraft | null;
}
function load(): Persisted {
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const p = JSON.parse(s) as Persisted;
      return { form: { ...defaultConstraints(), ...p.form }, basket: p.basket ?? null };
    }
  } catch {
    /* corrupted or unavailable */
  }
  return { form: defaultConstraints(), basket: null };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const initial = useRef(load()).current;
  const [config, setConfig] = useState<Config | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [form, setFormState] = useState<Constraints>(initial.form);
  const [basket, setBasketState] = useState<BasketDraft | null>(initial.basket);
  const [priced, setPriced] = useState<Priced | null>(null);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    api('/config')
      .then(setConfig)
      .catch(() => undefined);
    api('/areas')
      .then(setAreas)
      .catch(() => undefined);
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // persist the draft so a reload / language switch / sign-in never loses a basket
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ form, basket }));
    } catch {
      /* ignore */
    }
  }, [form, basket]);

  const setForm = useCallback(
    (f: Constraints | ((p: Constraints) => Constraints)) =>
      setFormState((p) => (typeof f === 'function' ? f(p) : f)),
    [],
  );
  const setBasket = useCallback((b: BasketDraft | null) => setBasketState(b), []);
  const clearBasket = useCallback(() => {
    setBasketState(null);
    setPriced(null);
  }, []);
  const setArea = useCallback((id: string | null) => setFormState((p) => ({ ...p, areaId: id })), []);
  const area = useMemo(() => areas.find((a) => a.id === form.areaId) ?? null, [areas, form.areaId]);

  // Reprice from the server after every change (debounced). The server is the only source of totals.
  const itemsKey = basket
    ? JSON.stringify([basket.storeId, basket.items, form.budgetMinor, form.budgetIncludesDelivery, form.baby])
    : '';
  useEffect(() => {
    if (!basket || !basket.items.length) {
      setPriced(null);
      return;
    }
    const ctrl = new AbortController();
    setPricing(true);
    const id = setTimeout(async () => {
      try {
        const p = await api<Priced>('/baskets/price', {
          body: {
            storeId: basket.storeId,
            items: basket.items,
            constraints: { ...toApiConstraints(form), areaId: form.areaId },
          },
          signal: ctrl.signal,
        });
        setPriced(p);
        setPriceError(null);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setPriceError(e?.code ?? 'ERROR');
      } finally {
        setPricing(false);
      }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const mutate = useCallback(
    (fn: (items: { productId: string; qty: number }[]) => { productId: string; qty: number }[]) => {
      setBasketState((b) => (b ? { ...b, items: fn(b.items) } : b));
      api('/analytics', {
        body: { name: 'basket_modified', props: { generationId: basket?.generationId ?? '' } },
      }).catch(() => undefined);
    },
    [basket?.generationId],
  );
  const setQty = useCallback(
    (id: string, qty: number) =>
      mutate((items) =>
        qty <= 0
          ? items.filter((i) => i.productId !== id)
          : items.map((i) => (i.productId === id ? { ...i, qty: Math.min(99, qty) } : i)),
      ),
    [mutate],
  );
  const replaceItem = useCallback(
    (from: string, to: string) =>
      mutate((items) => {
        const cur = items.find((i) => i.productId === from);
        if (!cur) return items;
        const rest = items.filter((i) => i.productId !== from && i.productId !== to);
        return [...rest, { productId: to, qty: cur.qty }];
      }),
    [mutate],
  );
  const addItem = useCallback(
    (id: string, qty = 1) =>
      mutate((items) =>
        items.some((i) => i.productId === id)
          ? items.map((i) => (i.productId === id ? { ...i, qty: Math.min(99, i.qty + qty) } : i))
          : [...items, { productId: id, qty }],
      ),
    [mutate],
  );

  const value = useMemo(
    () => ({
      config,
      areas,
      area,
      form,
      setForm,
      basket,
      setBasket,
      priced,
      pricing,
      priceError,
      setQty,
      replaceItem,
      addItem,
      setArea,
      clearBasket,
      areaPickerOpen,
      setAreaPickerOpen,
      online,
    }),
    [
      config,
      areas,
      area,
      form,
      setForm,
      basket,
      setBasket,
      priced,
      pricing,
      priceError,
      setQty,
      replaceItem,
      addItem,
      setArea,
      clearBasket,
      areaPickerOpen,
      online,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
