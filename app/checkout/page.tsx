"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { validateReferralCode } from "@/lib/affiliate/api";
import {
  REFERRAL_CODE_MAX_LENGTH,
  REFERRAL_CODE_MIN_LENGTH,
  normalizeReferralCode,
} from "@/lib/affiliate/utils";
import { apiFetch } from "@/lib/api-fetch";
import { useCart } from "@/contexts/CartContext";
import { siteConfig } from "@/lib/config";
import { useToast } from "@/contexts/ToastContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { supabase } from "@/lib/supabase";
import type { ReferralCode } from "@/lib/supabase";
import AddressAutocomplete, {
  type AddressSuggestion,
} from "@/components/AddressAutocomplete";
import { QRCodeSVG } from "qrcode.react";
import PuramassCheckoutContent from "./PuramassCheckoutContent";
import {
  trackBeginCheckout,
  trackPurchase,
} from "@/lib/analytics/ecommerce";
import { cartItemToAnalytics } from "@/lib/analytics/cart";
import { trackActivity } from "@/lib/customer/activity";
import { DEFAULT_FLAT_SHIPPING } from "@/lib/payments/puramass-settings";

interface ShippingRate {
  courier_id: string;
  courier_name: string;
  service_name: string;
  total_charge: number;
  currency: string;
  min_delivery_time?: number;
  max_delivery_time?: number;
}
import {
  ShoppingCart,
  Tag,
  Check,
  X,
  User,
  MapPin,
  ArrowRight,
  Trash2,
  Lock,
  Loader2,
  AlertCircle,
  Beaker,
  ShieldCheck,
  Wallet,
  Copy,
  Clock,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  Truck,
  Plus,
  Droplets,
} from "lucide-react";
import { vialPriceFor } from "@/lib/pricing";
import { usePurchaseModal } from "@/contexts/PurchaseModalContext";

/** Reconstitution add-on offered in the order-summary column. */
interface UpsellProduct {
  id: string;
  name: string;
  price: number;
  vial_price: number | null;
  vials_per_box: number | null;
  stock_quantity: number;
  image_url: string | null;
  box_image_url: string | null;
  strength: string | null;
}

type SectionId = "contact" | "shipping" | "payment" | "referral";
type SectionStatusKind = "valid" | "invalid" | "neutral" | "loading";

// Shared dark tooltip used by both the collapsed-section status icons and the
// locked pay button. Shown via group-hover; alignable so the same shell can
// hang off a right-edge icon or a centered button.
function CheckoutTooltip({
  content,
  align = "center",
}: {
  content: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  const alignCls =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const arrowCls =
    align === "left"
      ? "left-4"
      : align === "right"
        ? "right-4"
        : "left-1/2 -translate-x-1/2";
  return (
    <div
      className={`pointer-events-none absolute bottom-full z-[120] mb-2 w-max max-w-[240px] translate-y-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 ${alignCls}`}
    >
      <div className="rounded-2xl bg-ink px-3 py-2 text-xs leading-snug text-white shadow-xl shadow-black/25 ring-1 ring-white/10">
        {content}
      </div>
      <div
        className={`absolute top-full -mt-1 h-2 w-2 rotate-45 bg-ink ring-1 ring-white/10 ${arrowCls}`}
      />
    </div>
  );
}

// The right-edge indicator on a collapsed section header.
function SectionStatus({
  status,
  label,
  reason,
}: {
  status: SectionStatusKind;
  label?: string;
  reason?: string;
}) {
  if (status === "valid") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-emerald-600">
        <CheckCircle className="h-4 w-4" />
        {label && (
          <span className="hidden max-w-[140px] truncate text-xs font-medium sm:inline">
            {label}
          </span>
        )}
      </span>
    );
  }
  if (status === "neutral") {
    return (
      <span className="shrink-0 text-xs text-ink-muted">{label || "Optional"}</span>
    );
  }
  if (status === "loading") {
    return (
      <span className="group relative shrink-0">
        <span className="flex items-center gap-1.5 rounded-full bg-teal/10 px-2 py-1 text-teal-dark">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
        {reason && <CheckoutTooltip content={reason} align="right" />}
      </span>
    );
  }
  // invalid
  return (
    <span className="group relative shrink-0">
      <span className="flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-1 text-amber-700">
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
      {reason && <CheckoutTooltip content={reason} align="right" />}
    </span>
  );
}

// Accordion card. Header bar toggles; body animates height/opacity. The
// collapse clip lives on the inner wrapper so header tooltips still escape
// upward out of the card.
function CollapsibleSection({
  icon,
  title,
  subtitle,
  status,
  statusLabel,
  statusReason,
  expanded,
  onToggle,
  onBlurOut,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  status: SectionStatusKind;
  statusLabel?: string;
  statusReason?: string;
  expanded: boolean;
  onToggle: () => void;
  onBlurOut?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border border-line bg-white"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onBlurOut?.();
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3 p-5 text-left transition-colors hover:bg-surface/60 ${
          expanded ? "rounded-t-2xl" : "rounded-2xl"
        }`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {!expanded && (
          <SectionStatus
            status={status}
            label={statusLabel}
            reason={statusReason}
          />
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Status line under the address input during progressive disclosure.
function AddressStatusLine({
  value,
  loading,
  onManual,
}: {
  value: string;
  loading: boolean;
  onManual: () => void;
}) {
  const q = value.trim();
  if (loading) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-teal-dark">
        <Loader2 className="h-3 w-3 animate-spin" />
        Looking up address…
      </p>
    );
  }
  if (q.length < 3) {
    return (
      <p className="mt-2 text-xs text-ink-muted">
        We&apos;ll suggest matches as you type.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={onManual}
      className="mt-2 text-xs text-teal-dark underline underline-offset-2 hover:text-teal-dark"
    >
      Can&apos;t find your address? Enter it manually
    </button>
  );
}

type CheckoutStep = "shipping" | "payment";
type CryptoOption = "btc" | "eth" | "sol";

interface PaymentInfo {
  orderNumber: string;
  paymentAddress: string;
  paymentAmount: string;
  crypto: CryptoOption;
  expiresAt: string;
  total: number;
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, totalPrice, clearCart, removeItem, updateQuantity, bumpKey } =
    useCart();
  const { openPurchaseModal } = usePurchaseModal();
  const { customer } = useCustomer();
  const toast = useToast();

  // Redirect out when e-commerce is disabled — done in an effect, not during
  // render, so we never navigate mid-render or call hooks conditionally.
  useEffect(() => {
    if (!siteConfig.ecommerceEnabled) router.replace("/products");
  }, [router]);

  // GA4 `begin_checkout`, once per visit to this page. The cart hydrates from
  // localStorage after mount, so this waits for the first non-empty `items`
  // rather than firing on mount with an empty basket.
  const beganCheckoutRef = useRef(false);
  useEffect(() => {
    if (beganCheckoutRef.current || items.length === 0) return;
    beganCheckoutRef.current = true;
    trackBeginCheckout(items.map(cartItemToAnalytics));
    // The same step in our own funnel, so the acquisition report can show how
    // many visitors each channel got this far — GA4 knows, but only inside
    // Google's UI, and never joined to the order that followed.
    void trackActivity({
      type: "checkout_start",
      metadata: { kind: "native", items: items.length },
    });
  }, [items]);

  // Stable idempotency key for this checkout attempt. Reused across retries
  // (so a dropped response doesn't create a duplicate order) and reset after a
  // successful placement.
  const idempotencyKeyRef = useRef<string>("");

  const [step, setStep] = useState<CheckoutStep>("shipping");
  const [referralCode, setReferralCode] = useState("");
  const [validatedCode, setValidatedCode] = useState<ReferralCode | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoOption>("btc");
  const [isProcessing, setIsProcessing] = useState(false);

  // Accordion + progressive-disclosure UI state.
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    contact: true,
    shipping: true,
    payment: true,
    referral: false,
  });
  const [blurredSections, setBlurredSections] = useState<Set<SectionId>>(
    new Set(),
  );
  const autoCollapsedRef = useRef<Set<SectionId>>(new Set());
  const hydratedCollapseRef = useRef(false);
  const [addressExpanded, setAddressExpanded] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [cartExpanded, setCartExpanded] = useState(false);
  const [showAllCouriers, setShowAllCouriers] = useState(false);
  // Phone is optional — but when it's missing at place-order time we confirm
  // once: continue without it, or jump to the Contact section's phone field.
  const [showPhoneWarning, setShowPhoneWarning] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  // Bacteriostatic-water add-ons offered next to the order summary. Fetched
  // once; only active, in-stock options are shown.
  const [upsellProducts, setUpsellProducts] = useState<UpsellProduct[]>([]);

  const toggleSection = (id: SectionId) =>
    setExpanded((s) => ({ ...s, [id]: !s[id] }));
  const markBlurred = (id: SectionId) =>
    setBlurredSections((s) => (s.has(id) ? s : new Set(s).add(id)));

  // Payment state (legacy crypto path — kept dormant).
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<
    "pending" | "received" | "confirmed"
  >("pending");
  const [confirmations, setConfirmations] = useState(0);
  const [copied, setCopied] = useState<"address" | "amount" | null>(null);
  const [timeLeft, setTimeLeft] = useState("");
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // e-Transfer confirmation state — populated after a successful POST to
  // /api/orders-email. Renders a thank-you screen instead of crypto/QR.
  const [etransferConfirmed, setETransferConfirmed] = useState<
    | {
        orderNumber: string;
        total: number;
        fulfillment: "shipment" | "pickup";
        customerEmail: string;
        etransfer?: {
          recipientEmail: string;
          securityQuestion: string;
          securityAnswerHint: string;
          amount: number;
          orderNumber: string;
        } | null;
      }
    | null
  >(null);

  const validationIdRef = useRef(0);
  const referralDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [shippingData, setShippingData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    postalCode: "",
    country: "CA",
  });

  // Live shipping rates (EasyShip via /api/shipping/rates). When the
  // address is incomplete we keep `rates` empty and `selectedRate` null
  // so the order summary hides the shipping line entirely (no $20 ghost).
  const [shippingRates, setShippingRates] = useState<ShippingRate[]>([]);
  const [selectedRate, setSelectedRate] = useState<ShippingRate | null>(null);
  const [fallbackRate, setFallbackRate] = useState<number | null>(null);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesNote, setRatesNote] = useState<string | null>(null);

  useEffect(() => {
    if (customer) {
      setShippingData({
        firstName: customer.first_name || "",
        lastName: customer.last_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        address: customer.shipping_address || "",
        city: customer.shipping_city || "",
        state: customer.shipping_state || "",
        postalCode: customer.shipping_postal_code || "",
        country: customer.shipping_country || "CA",
      });
    }
  }, [customer]);

  // Load the reconstitution add-ons (bacteriostatic water) for the sidebar
  // upsell. Non-critical: failures just hide the card.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const { data } = await supabase
          .from("products")
          .select(
            "id, name, price, vial_price, vials_per_box, pack_sizes, pack_options, stock_quantity, image_url, box_image_url, strength",
          )
          .ilike("name", "bacteriostatic%")
          .eq("active", true)
          .gt("stock_quantity", 0)
          .order("price", { ascending: true })
          .abortSignal(controller.signal);
        if (data) setUpsellProducts(data);
      } catch {
        /* keep the card hidden */
      }
    })();
    return () => controller.abort();
  }, []);

  // When something lands in the cart while on this page (the upsell's picker
  // is the only way that happens here), pop the order card open so the new
  // line is visible. The ref skips the value carried in from previous pages.
  const initialBumpKeyRef = useRef(bumpKey);
  useEffect(() => {
    if (bumpKey !== initialBumpKeyRef.current) setCartExpanded(true);
  }, [bumpKey]);

  // ---- Per-section validity (drives status indicators + auto-collapse) ----
  const emailValid = /.+@.+\..+/.test(shippingData.email.trim());
  // Phone is intentionally absent — it's optional (nudged at place-order time).
  const contactValid = Boolean(
    shippingData.firstName.trim() &&
      shippingData.lastName.trim() &&
      emailValid,
  );
  const shippingSectionValid = Boolean(
    shippingData.address.trim() &&
      shippingData.city.trim() &&
      shippingData.state.trim() &&
      shippingData.postalCode.trim(),
  );

  // Signed-in buyers with a saved profile: collapse Contact (and Shipping when
  // an address is on file) as soon as the customer record hydrates, and show
  // the full address form rather than the typeahead intro.
  useEffect(() => {
    if (hydratedCollapseRef.current || !customer) return;
    const hasAddress = Boolean(
      customer.shipping_address ||
        customer.shipping_city ||
        customer.shipping_postal_code,
    );
    if (!customer.first_name && !hasAddress) return;
    hydratedCollapseRef.current = true;
    if (hasAddress) setAddressExpanded(true);
    setExpanded((s) => ({
      ...s,
      contact: false,
      shipping: hasAddress ? false : s.shipping,
    }));
    autoCollapsedRef.current.add("contact");
    if (hasAddress) autoCollapsedRef.current.add("shipping");
  }, [customer]);

  // Auto-collapse a required section once it becomes valid AND has lost focus
  // at least once — never mid-edit, and at most once per section.
  useEffect(() => {
    if (
      contactValid &&
      blurredSections.has("contact") &&
      !autoCollapsedRef.current.has("contact")
    ) {
      autoCollapsedRef.current.add("contact");
      setExpanded((s) => ({ ...s, contact: false }));
    }
  }, [contactValid, blurredSections]);

  useEffect(() => {
    if (
      shippingSectionValid &&
      blurredSections.has("shipping") &&
      !autoCollapsedRef.current.has("shipping")
    ) {
      autoCollapsedRef.current.add("shipping");
      setExpanded((s) => ({ ...s, shipping: false }));
    }
  }, [shippingSectionValid, blurredSections]);

  // Fetch live shipping rates whenever the destination address is
  // complete enough to quote (postal code + country + city). Debounced
  // 350ms so the user typing a postal code doesn't trigger 6 queries.
  useEffect(() => {
    const { postalCode, country, city, address } = shippingData;
    if (!postalCode || !country || !city || !address) {
      setShippingRates([]);
      setSelectedRate(null);
      setFallbackRate(null);
      setRatesNote(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setRatesLoading(true);
      setRatesNote(null);
      try {
        const res = await fetch("/api/shipping/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipping: shippingData,
            items: items.map((it) => ({ quantity: it.quantity })),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setShippingRates([]);
          setSelectedRate(null);
          setFallbackRate(null);
          return;
        }
        const data = await res.json();
        const rates = (data.rates ?? []) as ShippingRate[];
        setShippingRates(rates);
        setFallbackRate(
          typeof data.fallback_rate === "number" ? data.fallback_rate : null,
        );
        setRatesNote(typeof data.note === "string" ? data.note : null);
        // Auto-select the cheapest if available; otherwise leave null
        // (fallback rate is shown only as a hint, never auto-charged).
        setSelectedRate((cur) => {
          if (rates.length === 0) return null;
          if (cur && rates.some((r) => r.courier_id === cur.courier_id)) {
            return cur;
          }
          return rates[0];
        });
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setShippingRates([]);
        setSelectedRate(null);
      } finally {
        setRatesLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shippingData.postalCode,
    shippingData.country,
    shippingData.city,
    shippingData.address,
    items.length,
  ]);

  useEffect(() => {
    const refParam = searchParams.get("ref");
    if (refParam) {
      const seeded = normalizeReferralCode(refParam);
      setReferralCode(seeded);
      validateCode(seeded);
      return;
    }
    // Fall back to the cookie set by middleware when user entered via a referral
    // link. Split on the FIRST '=' only and decode, so a value is never
    // truncated or left percent-encoded.
    const cookieRow = document.cookie
      .split('; ')
      .find((row) => row.startsWith('ref_code='));
    if (cookieRow) {
      const rawValue = cookieRow.slice(cookieRow.indexOf('=') + 1);
      let cookieCode = rawValue;
      try {
        cookieCode = decodeURIComponent(rawValue);
      } catch {
        /* malformed encoding — fall back to the raw value */
      }
      cookieCode = normalizeReferralCode(cookieCode);
      if (cookieCode) {
        setReferralCode(cookieCode);
        validateCode(cookieCode);
      }
    }
  }, [searchParams]);

  // Countdown timer
  useEffect(() => {
    if (!paymentInfo?.expiresAt || paymentStatus === "confirmed") return;

    const updateTimer = () => {
      const now = new Date().getTime();
      const expires = new Date(paymentInfo.expiresAt).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft("Expired");
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [paymentInfo?.expiresAt, paymentStatus]);

  // Poll for payment status
  const requiredConfirmations: Record<string, number> = {
    btc: 1,
    eth: 12,
    sol: 1,
  };

  const pollPayment = useCallback(async () => {
    if (!paymentInfo?.orderNumber) return;
    try {
      const data = await apiFetch<{ status: string; confirmations?: number }>(
        `/api/orders/check-payment?orderNumber=${paymentInfo.orderNumber}`,
        { timeoutMs: 8_000 },
      );
      if (data.confirmations !== undefined) {
        setConfirmations(data.confirmations);
      }
      if (data.status === "received" && paymentStatus !== "received") {
        setPaymentStatus("received");
      }
      if (data.status === "confirmed") {
        setPaymentStatus("confirmed");
        setConfirmations(
          data.confirmations || requiredConfirmations[paymentInfo.crypto] || 1,
        );
        if (pollRef.current) clearInterval(pollRef.current);
        clearCart();
        setTimeout(() => {
          router.push(`/order/track?order=${paymentInfo.orderNumber}`);
        }, 5000);
      }
    } catch { /* polling — silently ignore transient network blips */ }
  }, [
    paymentInfo?.orderNumber,
    paymentInfo?.crypto,
    paymentStatus,
    clearCart,
    router,
  ]);

  useEffect(() => {
    if (
      step === "payment" &&
      paymentInfo &&
      (paymentStatus === "pending" || paymentStatus === "received")
    ) {
      pollRef.current = setInterval(pollPayment, 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [step, paymentInfo, paymentStatus, pollPayment]);

  const validateCode = async (code: string) => {
    // Codes are 4-20 characters, so validation fires once the input is long
    // enough to be one — never on an exact width.
    if (!code || code.length < REFERRAL_CODE_MIN_LENGTH) {
      setValidationError("");
      setValidatedCode(null);
      return;
    }

    const callId = ++validationIdRef.current;
    setIsValidating(true);
    setValidationError("");
    try {
      const result = await validateReferralCode(code);
      if (validationIdRef.current !== callId) return;
      if (result) {
        setValidatedCode(result);
        setValidationError("");
      } else {
        setValidatedCode(null);
        setValidationError("Invalid referral code");
      }
    } catch {
      if (validationIdRef.current !== callId) return;
      setValidatedCode(null);
      setValidationError("Could not validate code");
    } finally {
      if (validationIdRef.current === callId) setIsValidating(false);
    }
  };

  const handleReferralCodeChange = (value: string) => {
    const code = normalizeReferralCode(value);
    setReferralCode(code);

    if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current);

    if (code.length < REFERRAL_CODE_MIN_LENGTH) {
      setValidatedCode(null);
      setValidationError("");
      return;
    }

    // Debounced: a vanity code is typed a character at a time and every
    // keystroke would otherwise be a round trip.
    referralDebounceRef.current = setTimeout(() => validateCode(code), 350);
  };

  const handleShippingChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setShippingData({ ...shippingData, [e.target.name]: e.target.value });
  };

  const handleProceedToPayment = async (opts?: { skipPhoneCheck?: boolean }) => {
    if (items.length === 0) {
      toast.error("Your cart is empty");
      return;
    }

    if (
      !shippingData.firstName ||
      !shippingData.lastName ||
      !shippingData.email
    ) {
      toast.error("Please fill in your name and email");
      return;
    }

    if (
      !shippingData.address ||
      !shippingData.city ||
      !shippingData.state ||
      !shippingData.postalCode
    ) {
      toast.error("Please fill in your shipping address");
      return;
    }

    // Phone is optional, but confirm the omission once — couriers use it to
    // coordinate delivery. The dialog either resumes with skipPhoneCheck or
    // jumps the buyer to the phone field.
    if (!shippingData.phone.trim() && !opts?.skipPhoneCheck) {
      setShowPhoneWarning(true);
      return;
    }

    setIsProcessing(true);

    // Generate the idempotency key once and keep it across retries, so a
    // dropped/timed-out response can't turn one order into two.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      // e-Transfer flow: POST /api/orders-email. The route re-prices every line
      // server-side, decides the discount + shipping authoritatively, creates
      // the order in `pending`, and returns the e-Transfer details so we can
      // show them on-screen (the email is a convenience, not the only channel).
      const data = await apiFetch<{
        success: boolean;
        order: {
          id: string;
          order_number: string;
          total: number;
          fulfillment_type: "shipment" | "pickup";
        };
        etransfer?: {
          recipientEmail: string;
          securityQuestion: string;
          securityAnswerHint: string;
          amount: number;
          orderNumber: string;
        } | null;
      }>("/api/orders-email", {
        method: "POST",
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.productId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            strength: item.strength,
            unit: item.unit,
            packSize: item.packSize,
            vialsPerBox: item.vialsPerBox,
          })),
          shipping: {
            firstName: shippingData.firstName,
            lastName: shippingData.lastName,
            email: shippingData.email,
            phone: shippingData.phone,
            address: shippingData.address,
            city: shippingData.city,
            state: shippingData.state,
            postalCode: shippingData.postalCode,
            country: shippingData.country,
          },
          fulfillment_type: "shipment",
          // Send the rate the buyer saw (selected courier, or the flat fallback
          // when no live rate came back). The server re-computes authoritatively
          // and never charges below its own quote.
          shippingCost: selectedRate?.total_charge ?? fallbackRate ?? 0,
          selectedCourier: selectedRate
            ? {
                courier_id: selectedRate.courier_id,
                courier_name: selectedRate.courier_name,
                service_name: selectedRate.service_name,
              }
            : undefined,
          referralCode: validatedCode?.code,
          customerId: customer?.id,
          idempotencyKey: idempotencyKeyRef.current,
        }),
        timeoutMs: 30_000,
      });

      setETransferConfirmed({
        orderNumber: data.order.order_number,
        total: data.order.total,
        fulfillment: data.order.fulfillment_type,
        customerEmail: shippingData.email,
        etransfer: data.etransfer ?? null,
      });
      // GA4 `purchase` — fired before clearCart(), while `items` still holds
      // the lines. `value` is the total the server priced, not the cart
      // subtotal, so the authoritative discount + shipping are what GA4 sees.
      // The order number is the transaction id, so GA4 dedupes if the buyer
      // reloads the confirmation.
      trackPurchase({
        transactionId: data.order.order_number,
        value: data.order.total,
        shipping: selectedRate?.total_charge ?? fallbackRate ?? 0,
        items: items.map(cartItemToAnalytics),
      });
      // Success — the next order should get a fresh idempotency key.
      idempotencyKeyRef.current = "";
      clearCart();
    } catch (err: any) {
      console.error("Checkout error:", err);
      toast.error(
        err.message || "Failed to process checkout. Please try again.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // "Add phone number" in the missing-phone dialog: open the Contact section
  // (its fields unmount while collapsed), then scroll to and focus the input
  // once the expand animation has played.
  const focusPhoneField = () => {
    setShowPhoneWarning(false);
    setExpanded((s) => ({ ...s, contact: true }));
    setTimeout(() => {
      const el = phoneInputRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }, 300);
  };

  const copyToClipboard = async (text: string, type: "address" | "amount") => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const cryptoOptions = [
    {
      value: "btc" as CryptoOption,
      label: "Bitcoin",
      sublabel: "BTC",
      icon: "\u20BF",
    },
    {
      value: "eth" as CryptoOption,
      label: "Ethereum",
      sublabel: "ETH",
      icon: "\u039E",
    },
    {
      value: "sol" as CryptoOption,
      label: "Solana",
      sublabel: "SOL",
      icon: "\u25CE",
    },
  ];

  const chainNames: Record<string, string> = {
    btc: "Bitcoin",
    eth: "Ethereum",
    sol: "Solana",
  };
  const explorerUrls: Record<string, string> = {
    btc: "https://mempool.space/tx/",
    eth: "https://etherscan.io/tx/",
    sol: "https://explorer.solana.com/tx/",
  };

  // Render nothing while the disabled-store effect redirects to /products.
  if (!siteConfig.ecommerceEnabled) return null;

  // e-Transfer confirmation — replaces the legacy crypto payment step.
  if (etransferConfirmed) {
    return (
      <div className="min-h-screen bg-white px-5 sm:px-8 py-12">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-3 mb-6">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <img src="/images/vyta-mark.png" alt="" aria-hidden="true" className="relative w-10 h-10 object-contain" />
              </div>
              <span className="text-lg font-bold text-ink">VYTA</span>
            </Link>
          </div>

          <div className="bg-white rounded-2xl border border-line p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Order received</h2>
            <p className="text-ink-muted text-sm mb-6">
              Thank you. We've sent a confirmation to{" "}
              <span className="font-medium text-ink">
                {etransferConfirmed.customerEmail}
              </span>
              .
            </p>

            <div className="bg-surface rounded-xl p-4 mb-6 text-left">
              <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1">
                Order number
              </p>
              <p className="text-base font-semibold text-ink font-mono">
                {etransferConfirmed.orderNumber}
              </p>
              <p className="text-[11px] text-ink-muted uppercase tracking-wide mt-3 mb-1">
                Total
              </p>
              <p className="text-base font-semibold text-ink">
                ${etransferConfirmed.total.toFixed(2)} CAD
              </p>
            </div>

            {/* Interac e-Transfer details shown ON-SCREEN so the buyer can pay
                immediately — the emailed copy is a convenience, not the only
                channel (previously a failed/greylisted email left the order
                un-payable with no on-page fallback). */}
            {etransferConfirmed.fulfillment === "shipment" &&
            etransferConfirmed.etransfer ? (
              <div className="bg-teal/5 border border-teal/30 rounded-xl p-4 mb-6 text-left">
                <p className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-teal-dark" />
                  Complete your payment by Interac e-Transfer
                </p>
                <p className="text-xs text-ink-muted mb-3">
                  Send the exact amount below from your online banking. We've
                  also emailed these details — check spam if it hasn't arrived.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">Send to</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-ink font-mono break-all">
                        {etransferConfirmed.etransfer.recipientEmail}
                      </span>
                      <button
                        type="button"
                        aria-label="Copy recipient email"
                        onClick={() =>
                          copyToClipboard(
                            etransferConfirmed.etransfer!.recipientEmail,
                            "address",
                          )
                        }
                        className="p-1 text-ink-muted hover:text-teal-dark"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">Amount</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink tabular-nums">
                        ${etransferConfirmed.etransfer.amount.toFixed(2)} CAD
                      </span>
                      <button
                        type="button"
                        aria-label="Copy amount"
                        onClick={() =>
                          copyToClipboard(
                            etransferConfirmed.etransfer!.amount.toFixed(2),
                            "amount",
                          )
                        }
                        className="p-1 text-ink-muted hover:text-teal-dark"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                  {etransferConfirmed.etransfer.securityQuestion && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-muted">
                        Security question
                      </span>
                      <span className="text-sm text-ink text-right">
                        {etransferConfirmed.etransfer.securityQuestion}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-muted">
                      Security answer
                    </span>
                    <span className="text-sm font-medium text-ink">
                      {etransferConfirmed.etransfer.securityAnswerHint}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-teal/20">
                    <span className="text-xs text-ink-muted">Message / memo</span>
                    <span className="text-sm font-mono text-ink">
                      {etransferConfirmed.orderNumber}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
                <div className="flex items-start gap-3">
                  <Wallet className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-ink mb-1">
                      {etransferConfirmed.fulfillment === "pickup"
                        ? "Payment instructions coming shortly"
                        : "Payment instructions on the way"}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {etransferConfirmed.fulfillment === "pickup"
                        ? "We'll be in touch once your pickup order is ready. Payment due at pickup."
                        : "We've emailed you the Interac e-Transfer details (recipient, security question, and the exact amount). Check your inbox (and the spam folder just in case) to complete payment."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/products"
                className="px-6 py-2.5 border border-line rounded-xl text-sm font-medium text-ink hover:bg-surface transition-colors"
              >
                Continue Shopping
              </Link>
              {customer ? (
                <Link
                  href="/account/orders"
                  className="px-6 py-2.5 bg-ink text-white rounded-xl text-sm font-medium hover:bg-ink/90 transition-colors"
                >
                  View your orders
                </Link>
              ) : (
                <Link
                  href={`/order/track?order=${encodeURIComponent(
                    etransferConfirmed.orderNumber,
                  )}&email=${encodeURIComponent(etransferConfirmed.customerEmail)}`}
                  className="px-6 py-2.5 bg-ink text-white rounded-xl text-sm font-medium hover:bg-ink/90 transition-colors"
                >
                  Track your order
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Legacy crypto payment step (kept for reference — unreachable now that
  // the form submits to /api/orders-email and sets etransferConfirmed).
  if (step === "payment" && paymentInfo) {
    return (
      <div className="min-h-screen bg-white px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-lg mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-3 mb-6">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <img src="/images/vyta-mark.png" alt="" aria-hidden="true" className="relative w-10 h-10 object-contain" />
              </div>
              <span className="text-lg font-bold text-ink">VYTA</span>
            </Link>
          </div>

          {paymentStatus === "confirmed" ? (
            <div className="bg-white rounded-2xl border border-line p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">
                Payment Confirmed!
              </h2>
              <p className="text-ink-muted text-sm mb-2">
                Your payment has been fully confirmed on the blockchain.
              </p>
              <p className="text-ink-muted text-sm mb-4">
                Your order is now being processed. Redirecting to order
                tracking...
              </p>
              <p className="text-green-600 text-xs font-medium mb-4">
                You can safely close this page.
              </p>
              <Loader2 className="w-5 h-5 text-teal-dark animate-spin mx-auto" />
            </div>
          ) : paymentStatus === "received" ? (
            <div className="bg-white rounded-2xl border border-line overflow-hidden">
              <div className="bg-green-50 px-6 py-4 border-b border-green-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-green-800">
                      Payment Received!
                    </h2>
                    <p className="text-xs text-green-600">
                      You can safely close this page now.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="text-center">
                  <p className="text-sm text-ink-muted mb-4">
                    Your {chainNames[paymentInfo.crypto]} payment has been
                    detected. Once the required confirmations are reached, your
                    order will be processed.
                  </p>
                </div>

                {/* Confirmation progress */}
                <div className="bg-surface rounded-xl p-5 border border-line">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">
                      Confirmations
                    </span>
                    <span className="text-sm font-bold text-ink tabular-nums">
                      {confirmations} /{" "}
                      {requiredConfirmations[paymentInfo.crypto] || 1}
                    </span>
                  </div>
                  <div className="w-full bg-line rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-green-500 h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, (confirmations / (requiredConfirmations[paymentInfo.crypto] || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-ink-muted mt-3 text-center">
                    {paymentInfo.crypto === "btc"
                      ? "Bitcoin confirmations typically take ~10 minutes each."
                      : paymentInfo.crypto === "eth"
                        ? "Ethereum confirmations take ~12 seconds each."
                        : "Solana confirmations are nearly instant."}
                  </p>
                </div>

                {/* Order info */}
                <div className="bg-surface rounded-xl p-4 border border-line">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-muted">Order</span>
                    <span className="font-bold text-ink font-mono">
                      {paymentInfo.orderNumber}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-ink-muted">Total</span>
                    <span className="font-bold text-ink">
                      ${paymentInfo.total.toFixed(2)} CAD
                    </span>
                  </div>
                </div>

                {/* Polling indicator */}
                <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Monitoring confirmations...</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Do not close warning */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-800 font-medium">
                  Do not close this page until your payment has been detected.
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-line overflow-hidden">
                {/* Order info header */}
                <div className="bg-surface px-6 py-4 border-b border-line">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-ink-muted">Order</p>
                      <p className="font-bold text-ink">
                        {paymentInfo.orderNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-ink-muted">Total</p>
                      <p className="font-bold text-ink">
                        ${paymentInfo.total.toFixed(2)} CAD
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold text-ink mb-1">
                      Send {chainNames[paymentInfo.crypto]}
                    </h2>
                    <p className="text-xs text-ink-muted">
                      Scan the QR code or copy the address below
                    </p>
                  </div>

                  {/* QR Code */}
                  <div className="flex justify-center">
                    <div className="bg-white p-4 rounded-2xl border border-line shadow-sm">
                      <QRCodeSVG
                        value={paymentInfo.paymentAddress}
                        size={200}
                        level="H"
                        includeMargin={true}
                      />
                    </div>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-2">
                      Amount
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface px-4 py-3 rounded-xl text-sm font-mono text-ink border border-line truncate">
                        {paymentInfo.paymentAmount}{" "}
                        {paymentInfo.crypto.toUpperCase()}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(paymentInfo.paymentAmount, "amount")
                        }
                        className={`p-3 rounded-xl transition-colors flex-shrink-0 ${
                          copied === "amount"
                            ? "bg-green-100 text-green-600"
                            : "bg-surface hover:bg-line text-ink-muted border border-line"
                        }`}
                      >
                        {copied === "amount" ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-xs font-medium text-ink-muted mb-2">
                      Payment Address
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface px-4 py-3 rounded-xl text-xs font-mono text-ink border border-line break-all">
                        {paymentInfo.paymentAddress}
                      </code>
                      <button
                        onClick={() =>
                          copyToClipboard(paymentInfo.paymentAddress, "address")
                        }
                        className={`p-3 rounded-xl transition-colors flex-shrink-0 ${
                          copied === "address"
                            ? "bg-green-100 text-green-600"
                            : "bg-surface hover:bg-line text-ink-muted border border-line"
                        }`}
                      >
                        {copied === "address" ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Timer */}
                  <div className="flex items-center justify-center gap-2 bg-surface rounded-xl py-3 border border-line">
                    <Clock className="w-4 h-4 text-ink-muted" />
                    <span className="text-sm text-ink-muted">
                      {timeLeft === "Expired" ? (
                        <span className="text-red-600 font-medium">
                          Payment window expired
                        </span>
                      ) : (
                        <>
                          Expires in{" "}
                          <span className="font-mono font-medium text-ink">
                            {timeLeft}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Polling indicator */}
                  <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Checking for payment every 5 seconds...</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 text-center">
                <Link
                  href="/products"
                  className="text-ink-muted hover:text-teal-dark transition-colors text-sm"
                >
                  &larr; Continue Shopping
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Prefer the explicitly selected EasyShip rate; when EasyShip returned no live
  // rates but a flat fallback is available, charge that (previously the fallback
  // was shown but never added to the total). Only when the address is
  // incomplete (no rate and no fallback) does shipping stay 0 / hidden.
  const shippingCharge = selectedRate?.total_charge ?? fallbackRate ?? 0;
  const finalTotal = totalPrice + shippingCharge;

  // Gate the submit button: require the full shipping address plus the
  // contact fields before an order can be placed. Phone is optional — a
  // missing one only triggers a confirm dialog at place-order time.
  const shippingComplete = Boolean(
    shippingData.firstName.trim() &&
      shippingData.lastName.trim() &&
      emailValid &&
      shippingData.address.trim() &&
      shippingData.city.trim() &&
      shippingData.state.trim() &&
      shippingData.postalCode.trim(),
  );

  // A courier must be chosen (or a fallback rate resolved) before we let the
  // order through — otherwise we'd ship with $0 / unknown shipping cost.
  const ratesReady = !ratesLoading && (selectedRate != null || fallbackRate != null);

  // Explain exactly what's still needed before the order can be placed — used
  // both for the inline hint and the hover tooltip on the locked button. The
  // chain runs contact/address first, then the shipping-rate gate.
  const missingFieldMessage = !shippingData.firstName.trim() || !shippingData.lastName.trim()
    ? 'Enter your name to continue'
    : !emailValid
      ? 'Enter a valid email to continue'
      : !shippingData.address.trim()
        ? 'Enter your shipping address to continue'
        : !shippingData.city.trim()
          ? 'Enter your city to continue'
          : !shippingData.state.trim()
            ? 'Enter your province to continue'
            : !shippingData.postalCode.trim()
              ? 'Enter your postal code to continue'
              : ratesLoading
                ? 'Calculating shipping rates…'
                : !ratesReady
                  ? 'Select a shipping method to continue'
                  : '';

  // The button stays locked until contact + address are filled AND a shipping
  // rate has been calculated and selected.
  const canPlaceOrder = shippingComplete && ratesReady;

  // Courier list sliced to the cheapest 3, but the selected pick always stays
  // visible even when it sits past index 2 in a collapsed list.
  const sortedRates = [...shippingRates].sort(
    (a, b) => a.total_charge - b.total_charge,
  );
  const visibleRates = (() => {
    if (showAllCouriers || sortedRates.length <= 3) return sortedRates;
    const first3 = sortedRates.slice(0, 3);
    if (
      selectedRate &&
      !first3.some(
        (r) =>
          r.courier_id === selectedRate.courier_id &&
          r.service_name === selectedRate.service_name,
      )
    ) {
      return [...first3, selectedRate];
    }
    return first3;
  })();
  const hiddenCourierCount = Math.max(0, sortedRates.length - 3);

  // Everything still missing before the order can be placed, grouped by the
  // section title the buyer needs to open — drives the locked-button tooltip.
  const groupedMissing: { section: string; fields: string[] }[] = [];
  {
    const contactFields: string[] = [];
    if (!shippingData.firstName.trim()) contactFields.push("First name");
    if (!shippingData.lastName.trim()) contactFields.push("Last name");
    if (!emailValid) contactFields.push("Email");
    if (contactFields.length)
      groupedMissing.push({
        section: "Contact Information",
        fields: contactFields,
      });

    const shipFields: string[] = [];
    if (!shippingData.address.trim()) shipFields.push("Street address");
    if (!shippingData.city.trim()) shipFields.push("City");
    if (!shippingData.state.trim()) shipFields.push("Province");
    if (!shippingData.postalCode.trim()) shipFields.push("Postal code");
    if (shippingComplete && !ratesReady)
      shipFields.push(
        ratesLoading ? "Calculating shipping" : "Select a shipping method",
      );
    if (shipFields.length)
      groupedMissing.push({ section: "Shipping Address", fields: shipFields });

    if (items.length === 0)
      groupedMissing.push({ section: "Your Order", fields: ["Add items"] });
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-line">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="relative w-10 h-10 flex items-center justify-center">
                <img src="/images/vyta-mark.png" alt="" aria-hidden="true" className="relative w-10 h-10 object-contain" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-ink tracking-tight leading-none">
                  VYTA
                </span>
                <span className="text-[10px] text-teal-dark tracking-[0.15em] font-medium uppercase mt-0.5">
                  Secure Checkout
                </span>
              </div>
            </Link>
            <div className="flex items-center gap-2 px-4 py-2 bg-surface rounded-full border border-line">
              <Lock className="w-4 h-4 text-teal-dark" />
              <span className="text-sm font-medium text-ink-muted">
                SSL Encrypted
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-5xl mx-auto">
          {items.length === 0 ? (
            <div className="bg-surface rounded-2xl p-10 md:p-12 text-center border border-line">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 border border-line">
                <ShoppingCart className="w-8 h-8 text-ink-muted" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-2">
                Your cart is empty
              </h2>
              <p className="text-ink-muted mb-6 text-sm">
                Add some research compounds before checking out
              </p>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-6 py-3 rounded-xl font-semibold transition-all text-sm"
              >
                <span>Browse Catalog</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
              {/* Main Checkout Form */}
              <div className="lg:col-span-2 space-y-5">
                {/* Login Prompt - Optional */}
                {!customer && (
                  <div className="bg-surface rounded-2xl p-4 border border-line">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-ink-muted">
                        Already have an account?{" "}
                        <Link
                          href="/login?redirect=/checkout"
                          className="text-teal-dark hover:underline font-medium"
                        >
                          Sign in
                        </Link>{" "}
                        for order tracking
                      </p>
                    </div>
                  </div>
                )}

                {/* Customer Info */}
                <CollapsibleSection
                  icon={<User className="w-5 h-5 text-ink" />}
                  title="Contact Information"
                  status={contactValid ? "valid" : "invalid"}
                  statusLabel={
                    contactValid
                      ? `${shippingData.firstName} ${shippingData.lastName}`.trim() ||
                        shippingData.email
                      : undefined
                  }
                  statusReason={`Add ${
                    groupedMissing
                      .find((g) => g.section === "Contact Information")
                      ?.fields.join(", ") ?? "your details"
                  }`}
                  expanded={expanded.contact}
                  onToggle={() => toggleSection("contact")}
                  onBlurOut={() => markBlurred("contact")}
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        First Name *
                      </label>
                      <input
                        type="text"
                        name="firstName"
                        value={shippingData.firstName}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        name="lastName"
                        value={shippingData.lastName}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="Doe"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={shippingData.email}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="john@example.com"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Phone <span className="font-normal">(optional)</span>
                      </label>
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        name="phone"
                        value={shippingData.phone}
                        onChange={handleShippingChange}
                        className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Shipping Address */}
                <CollapsibleSection
                  icon={<MapPin className="w-5 h-5 text-ink" />}
                  title="Shipping Address"
                  status={
                    shippingSectionValid
                      ? "valid"
                      : ratesLoading
                        ? "loading"
                        : "invalid"
                  }
                  statusLabel={
                    shippingSectionValid
                      ? [shippingData.city, shippingData.state]
                          .filter(Boolean)
                          .join(", ")
                      : undefined
                  }
                  statusReason={
                    ratesLoading
                      ? "Calculating shipping…"
                      : `Add ${
                          groupedMissing
                            .find((g) => g.section === "Shipping Address")
                            ?.fields.join(", ") ?? "your address"
                        }`
                  }
                  expanded={expanded.shipping}
                  onToggle={() => toggleSection("shipping")}
                  onBlurOut={() => markBlurred("shipping")}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-muted mb-2">
                        Street Address *
                      </label>
                      <AddressAutocomplete
                        value={shippingData.address}
                        onChange={(next) =>
                          setShippingData((d) => ({ ...d, address: next }))
                        }
                        onPick={(s: AddressSuggestion) => {
                          setShippingData((d) => ({
                            ...d,
                            address: s.address,
                            city: s.city || d.city,
                            state: s.state || d.state,
                            postalCode: s.postalCode || d.postalCode,
                            country: s.country || d.country || "CA",
                          }));
                          setAddressExpanded(true);
                        }}
                        onLoadingChange={setAddrLoading}
                        placeholder="Start typing your address…"
                        name="address"
                      />
                      {!addressExpanded && (
                        <AddressStatusLine
                          value={shippingData.address}
                          loading={addrLoading}
                          onManual={() => setAddressExpanded(true)}
                        />
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {addressExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-ink-muted mb-2">
                                  City *
                                </label>
                                <input
                                  type="text"
                                  name="city"
                                  value={shippingData.city}
                                  onChange={handleShippingChange}
                                  className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                                  placeholder="Toronto"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-ink-muted mb-2">
                                  Province *
                                </label>
                                <input
                                  type="text"
                                  name="state"
                                  value={shippingData.state}
                                  onChange={handleShippingChange}
                                  className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                                  placeholder="ON"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-ink-muted mb-2">
                                  Postal Code *
                                </label>
                                <input
                                  type="text"
                                  name="postalCode"
                                  value={shippingData.postalCode}
                                  onChange={handleShippingChange}
                                  className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink placeholder-ink-muted"
                                  placeholder="M5V 1A1"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-ink-muted mb-2">
                                  Country
                                </label>
                                <select
                                  name="country"
                                  value={shippingData.country}
                                  onChange={handleShippingChange}
                                  className="w-full px-4 py-3 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-teal/40 focus:border-transparent text-sm bg-white text-ink"
                                >
                                  <option value="CA">Canada</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </CollapsibleSection>

                {/* Payment Method — Interac e-Transfer */}
                <CollapsibleSection
                  icon={<Wallet className="w-5 h-5 text-ink" />}
                  title="Payment Method"
                  subtitle="Interac e-Transfer"
                  status="valid"
                  statusLabel="Interac e-Transfer"
                  expanded={expanded.payment}
                  onToggle={() => toggleSection("payment")}
                >
                  <div className="rounded-xl border-2 border-teal bg-teal/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white border border-line flex items-center justify-center flex-shrink-0">
                        <Wallet className="w-5 h-5 text-teal-dark" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-ink">
                          Interac e-Transfer
                        </p>
                        <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                          Place your order now. We'll email payment instructions
                          (recipient, security question, amount) shortly after.
                          You'll send the e-Transfer from your bank, then reply
                          to confirm — we'll fulfill once payment is received.
                        </p>
                      </div>
                      <div className="w-5 h-5 bg-teal rounded-full flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Referral Code */}
                <CollapsibleSection
                  icon={<Tag className="w-5 h-5 text-ink" />}
                  title="Referral Code"
                  status={
                    isValidating
                      ? "loading"
                      : validatedCode
                        ? "valid"
                        : validationError
                          ? "invalid"
                          : "neutral"
                  }
                  statusLabel={
                    validatedCode
                      ? "Applied"
                      : validationError
                        ? undefined
                        : "Optional"
                  }
                  statusReason={
                    isValidating
                      ? "Validating code…"
                      : validationError || undefined
                  }
                  expanded={expanded.referral}
                  onToggle={() => toggleSection("referral")}
                >
                  <div className="relative">
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => handleReferralCodeChange(e.target.value)}
                      maxLength={REFERRAL_CODE_MAX_LENGTH}
                      placeholder="Enter your referral code (optional)"
                      className={`w-full px-4 py-3 pr-12 border-2 rounded-xl focus:outline-none transition-colors uppercase font-mono text-sm tracking-wider ${
                        validatedCode
                          ? "border-green-500 bg-green-50 text-green-700"
                          : validationError
                            ? "border-red-500 bg-red-50 text-red-700"
                            : "border-line bg-white text-ink focus:border-teal/40"
                      }`}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {isValidating ? (
                        <Loader2 className="w-5 h-5 text-ink-muted animate-spin" />
                      ) : validatedCode ? (
                        <Check className="w-5 h-5 text-green-500" />
                      ) : validationError ? (
                        <X className="w-5 h-5 text-red-500" />
                      ) : null}
                    </div>
                  </div>
                  {validationError && (
                    <p className="mt-2 text-xs text-red-600">
                      {validationError}
                    </p>
                  )}
                  {validatedCode && (
                    <p className="mt-2 text-xs text-green-600">
                      Code applied! Your affiliate will earn commission.
                    </p>
                  )}
                </CollapsibleSection>
              </div>

              {/* Order Summary Sidebar */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6 space-y-4">
                  {/* Cart Items Card */}
                  <div className="bg-white rounded-2xl border border-line overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCartExpanded((v) => !v)}
                      className={`w-full px-6 py-4 flex items-center justify-between text-left transition-colors hover:bg-surface/50 ${
                        cartExpanded ? "border-b border-line" : ""
                      }`}
                    >
                      <h2 className="text-base font-semibold text-ink">
                        Your Order
                      </h2>
                      <span className="flex items-center gap-2 text-xs text-ink-muted">
                        {items.length} {items.length === 1 ? "item" : "items"}
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${
                            cartExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </span>
                    </button>

                    <AnimatePresence initial={false}>
                      {cartExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                          style={{ overflow: "hidden" }}
                        >
                          <div className="divide-y divide-line">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="p-4 hover:bg-surface/50 transition-colors"
                        >
                          <div className="flex gap-4">
                            <div className="bg-surface w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 border border-line">
                              {item.image_url ? (
                                <img
                                  src={item.image_url}
                                  alt={item.name}
                                  className="w-full h-full object-contain rounded-xl p-1"
                                />
                              ) : (
                                <Beaker className="w-6 h-6 text-ink-muted" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-ink text-sm leading-tight">
                                {item.name}
                              </p>
                              <p className="text-xs text-ink-muted mt-1">
                                {item.strength}
                                <span className="ml-1.5 inline-flex items-center rounded-full bg-surface border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                                  {item.packSize > 1 ? `Pack of ${item.packSize}` : 'Single vial'}
                                </span>
                              </p>
                              <div className="flex items-center justify-between mt-3">
                                <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-line">
                                  <button
                                    onClick={() =>
                                      updateQuantity(item.id, item.quantity - 1)
                                    }
                                    aria-label={`Decrease quantity of ${item.name}`}
                                    className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center"
                                  >
                                    &minus;
                                  </button>
                                  <span className="text-sm text-ink tabular-nums w-8 text-center font-medium">
                                    {item.quantity}
                                  </span>
                                  <button
                                    onClick={() =>
                                      updateQuantity(item.id, item.quantity + 1)
                                    }
                                    aria-label={`Increase quantity of ${item.name}`}
                                    className="w-7 h-7 rounded-md text-ink-muted hover:bg-white hover:text-ink text-sm transition-colors flex items-center justify-center"
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="flex items-center gap-3">
                                  <p className="font-semibold text-ink tabular-nums">
                                    ${(item.price * item.quantity).toFixed(2)}
                                  </p>
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    aria-label={`Remove ${item.name} from order`}
                                    className="w-7 h-7 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Reconstitution add-ons — one-tap upsell of bacteriostatic
                      water vials next to the order summary */}
                  {upsellProducts.length > 0 && (
                    <div className="bg-white rounded-2xl border border-line overflow-hidden">
                      <div className="px-5 py-4 border-b border-line bg-surface/50">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-teal/20 bg-teal/10">
                            <Droplets className="w-4 h-4 text-teal-dark" />
                          </div>
                          <div>
                            <h2 className="text-sm font-semibold leading-tight text-ink">
                              Complete your kit
                            </h2>
                            <p className="mt-0.5 text-[11px] text-ink-muted">
                              Bacteriostatic water for reconstitution
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="divide-y divide-line">
                        {upsellProducts.map((p) => {
                          const vialPrice = vialPriceFor(p);
                          // Vials already in the order for this product,
                          // counting a pack line as its vials_per_box.
                          const vialsInOrder = items
                            .filter((i) => i.productId === p.id)
                            .reduce(
                              (sum, i) =>
                                sum + i.quantity * i.packSize,
                              0,
                            );
                          return (
                            <div
                              key={p.id}
                              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface/40"
                            >
                              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface">
                                {p.image_url ? (
                                  <img
                                    src={p.image_url}
                                    alt={p.name}
                                    className="h-full w-full object-contain p-1"
                                  />
                                ) : (
                                  <Beaker className="w-5 h-5 text-ink-muted" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold leading-snug text-ink">
                                  {p.name}
                                </p>
                                <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted">
                                  ${vialPrice.toFixed(2)}{" "}
                                  <span className="font-normal">/ vial</span>
                                  {vialsInOrder > 0 && (
                                    <span className="ml-1.5 inline-flex items-center rounded-full border border-teal/20 bg-teal-50 px-1.5 py-[1px] text-[9px] font-semibold text-teal-dark">
                                      In order ×{vialsInOrder}
                                    </span>
                                  )}
                                </p>
                              </div>
                              {/* Opens the shared single-vial / pack-of-N
                                  picker rather than committing a unit here */}
                              <button
                                onClick={() => openPurchaseModal(p)}
                                aria-label={`Add ${p.name} to order`}
                                className="flex h-8 items-center justify-center gap-1 rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-ink transition-all hover:border-ink/40"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary & Checkout Card */}
                  <div className="bg-white rounded-2xl p-6 border border-line">
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-ink-muted">Subtotal</span>
                        <span className="font-medium tabular-nums text-ink">
                          ${totalPrice.toFixed(2)}
                        </span>
                      </div>
                      {ratesLoading ? (
                        <div className="rounded-xl border border-line bg-surface/50 p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Truck className="w-4 h-4 text-teal-dark" />
                            <span className="text-sm font-medium text-ink">
                              Shipping
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-ink-muted mb-3">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Calculating shipping, please wait…
                          </div>
                          <div className="space-y-2">
                            <div className="h-9 rounded-lg bg-line/70 animate-pulse" />
                            <div className="h-9 rounded-lg bg-line/70 animate-pulse" />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-ink-muted">Shipping</span>
                            {selectedRate ? (
                              <span className="text-ink font-medium tabular-nums">
                                ${selectedRate.total_charge.toFixed(2)}{" "}
                                <span className="text-ink-muted text-xs">
                                  ({selectedRate.courier_name})
                                </span>
                              </span>
                            ) : (
                              <span className="text-ink-muted text-sm">
                                {shippingData.postalCode
                                  ? fallbackRate != null
                                    ? `Flat $${fallbackRate.toFixed(2)} fallback`
                                    : "Unavailable"
                                  : "Enter address"}
                              </span>
                            )}
                          </div>
                          {shippingRates.length > 1 && (
                            <div className="mt-2 space-y-1.5">
                              {visibleRates.map((r) => (
                                <button
                                  key={`${r.courier_id}-${r.service_name}`}
                                  type="button"
                                  onClick={() => setSelectedRate(r)}
                                  className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition ${
                                    selectedRate?.courier_id === r.courier_id
                                      ? "border-teal bg-teal/5"
                                      : "border-line bg-white hover:border-teal/40"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-ink">
                                      {r.courier_name}
                                    </span>
                                    <span className="tabular-nums">
                                      ${r.total_charge.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="text-ink-muted">
                                    {r.service_name}
                                    {r.min_delivery_time != null &&
                                    r.max_delivery_time != null
                                      ? ` · ${r.min_delivery_time}–${r.max_delivery_time}d`
                                      : ""}
                                  </div>
                                </button>
                              ))}
                              {hiddenCourierCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllCouriers((v) => !v)}
                                  className="flex items-center gap-1 text-xs font-medium text-teal-dark hover:text-teal-dark"
                                >
                                  {showAllCouriers
                                    ? "Show fewer options"
                                    : `Show ${hiddenCourierCount} more option${
                                        hiddenCourierCount === 1 ? "" : "s"
                                      }`}
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                      showAllCouriers ? "rotate-180" : ""
                                    }`}
                                  />
                                </button>
                              )}
                            </div>
                          )}
                          {ratesNote && (
                            <p className="text-[11px] text-ink-muted mt-1">
                              {ratesNote}
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="h-px bg-line my-5" />

                    <div className="flex justify-between items-center mb-6">
                      <span className="text-lg font-semibold text-ink">
                        Total
                      </span>
                      <div className="text-right">
                        <span className="text-2xl font-bold text-ink tabular-nums">
                          ${finalTotal.toFixed(2)}
                        </span>
                        <span className="text-ink-muted text-sm ml-1">CAD</span>
                      </div>
                    </div>

                    {/* Wrapper carries the hover tooltip — a disabled button
                        doesn't reliably fire hover events itself. */}
                    <div className="relative group">
                      <button
                        onClick={() => handleProceedToPayment()}
                        disabled={isProcessing || !canPlaceOrder}
                        className="w-full bg-ink hover:bg-ink/90 text-white py-3.5 rounded-xl font-semibold transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Placing order...</span>
                          </>
                        ) : shippingComplete && ratesLoading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Calculating shipping…</span>
                          </>
                        ) : (
                          <>
                            <Wallet className="w-5 h-5 shrink-0" />
                            <span className="flex flex-col items-start leading-tight">
                              <span className="text-[15px]">Place order</span>
                              <span className="text-[11px] font-normal text-white/70">
                                Pay by e-Transfer
                              </span>
                            </span>
                          </>
                        )}
                      </button>
                      {!canPlaceOrder && groupedMissing.length > 0 && (
                        <CheckoutTooltip
                          align="center"
                          content={
                            <div className="space-y-1">
                              <p className="flex items-center gap-1.5 font-semibold">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Complete to continue
                              </p>
                              {groupedMissing.map((g) => (
                                <p key={g.section} className="leading-snug">
                                  <span className="font-medium text-amber-300">
                                    {g.section}:
                                  </span>{" "}
                                  {g.fields.join(", ")}
                                </p>
                              ))}
                            </div>
                          }
                        />
                      )}
                    </div>
                    {!canPlaceOrder && (
                      <p className="text-xs text-ink-muted text-center mt-2 flex items-center justify-center gap-1.5">
                        <Lock className="w-3 h-3" />
                        {missingFieldMessage}
                      </p>
                    )}

                    {/* Trust badges */}
                    <div className="flex items-center justify-center gap-6 mt-5 pt-5 border-t border-line">
                      <div className="flex items-center gap-2 text-ink-muted">
                        <ShieldCheck className="w-4 h-4 text-teal-dark" />
                        <span className="text-xs">Secure Checkout</span>
                      </div>
                      <div className="flex items-center gap-2 text-ink-muted">
                        <Lock className="w-4 h-4 text-teal-dark" />
                        <span className="text-xs">SSL Encrypted</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Back to Home */}
          <div className="mt-8 text-center">
            <Link
              href="/"
              className="text-ink-muted hover:text-teal-dark transition-colors text-sm"
            >
              &larr; Back to VYTA Biosciences
            </Link>
          </div>
        </div>
      </div>

      {/* Missing-phone confirmation — phone is optional, but confirm the
          omission once before the order goes through. */}
      <AnimatePresence>
        {showPhoneWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
            onClick={() => setShowPhoneWarning(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="alertdialog"
              aria-modal="true"
              aria-label="No phone number provided"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-ink">
                    No phone number provided
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                    A phone number is optional, but couriers use it to
                    coordinate delivery. Add one, or place the order without
                    it.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setShowPhoneWarning(false);
                    handleProceedToPayment({ skipPhoneCheck: true });
                  }}
                  className="rounded-xl border border-line bg-white py-3 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
                >
                  Continue without
                </button>
                <button
                  onClick={focusPhoneField}
                  className="rounded-xl bg-ink py-3 text-sm font-semibold text-white transition-all hover:bg-ink/90"
                >
                  Add phone number
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Branded loading state for the whole checkout route — a header shell plus a
// shimmering skeleton of the layout, so the page never flashes a bare spinner
// while the checkout-mode setting (and, downstream, the cart) resolve.
function CheckoutLoadingScreen() {
  return (
    <div className="min-h-screen bg-white">
      <div className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 bg-ink rounded-xl flex items-center justify-center">
                <Beaker className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold text-ink tracking-tight leading-none">
                  VYTA
                </span>
                <span className="text-[10px] text-teal-dark tracking-[0.15em] font-medium uppercase mt-0.5">
                  Secure Checkout
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-surface rounded-full border border-line">
              <Loader2 className="w-4 h-4 text-teal-dark animate-spin" />
              <span className="text-sm font-medium text-ink-muted">
                Loading checkout…
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 sm:px-8 py-8 md:py-12">
        <div className="max-w-6xl mx-auto">
          <div className="h-16 rounded-2xl border border-line bg-surface/60 animate-pulse mb-6" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {[0, 1, 2].map((col) => (
              <div
                key={col}
                className="rounded-2xl border border-line bg-white p-5"
                style={{ animationDelay: `${col * 120}ms` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-xl bg-line/40 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-1/2 rounded bg-line/40 animate-pulse" />
                    <div className="h-2.5 w-3/4 rounded bg-line/30 animate-pulse" />
                  </div>
                </div>
                <div className="space-y-3">
                  {[0, 1, 2].map((row) => (
                    <div
                      key={row}
                      className="h-11 rounded-lg bg-line/30 animate-pulse"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Routes /checkout between the existing (crypto / e-transfer) checkout and the
// PuraMass hosted hand-off, based on the admin toggle. The settings read is
// `no-store` because it decides which checkout the customer sees. Every cart
// entry point (Proceed, Buy Now, cart drawer) navigates here, so this single
// branch covers them all.
function CheckoutRouter() {
  const [mode, setMode] = useState<"loading" | "puramass" | "default">("loading");
  const [guestCheckoutEnabled, setGuestCheckoutEnabled] = useState(true);
  const [shippingRatesEnabled, setShippingRatesEnabled] = useState(false);
  const [flatShipping, setFlatShipping] = useState(DEFAULT_FLAT_SHIPPING);
  const [freeShipping, setFreeShipping] = useState({ active: false, threshold: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings", { cache: "no-store" });
        const json = await res.json();
        const s = json?.settings ?? {};
        if (cancelled) return;
        setGuestCheckoutEnabled(s.guest_checkout_enabled ?? true);
        setShippingRatesEnabled(!!s.puramass_shipping_rates_enabled);
        setFlatShipping(Number(s.puramass_flat_shipping) || DEFAULT_FLAT_SHIPPING);
        setFreeShipping({
          active: !!s.puramass_free_shipping_active,
          threshold: Number(s.puramass_free_shipping_threshold) || 0,
        });
        setMode(s.puramass_checkout_enabled ? "puramass" : "default");
      } catch {
        if (!cancelled) setMode("default");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === "loading") {
    return <CheckoutLoadingScreen />;
  }

  if (mode === "puramass") {
    return (
      <PuramassCheckoutContent
        guestCheckoutEnabled={guestCheckoutEnabled}
        shippingRatesEnabled={shippingRatesEnabled}
        flatShipping={flatShipping}
        freeShippingActive={freeShipping.active}
        freeShippingThreshold={freeShipping.threshold}
      />
    );
  }

  return <CheckoutContent />;
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={<CheckoutLoadingScreen />}>
      <CheckoutRouter />
    </Suspense>
  );
}
