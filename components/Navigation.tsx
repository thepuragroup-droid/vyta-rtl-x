"use client";

import React, { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAffiliate } from "@/contexts/AffiliateContext";
import { useSiteConfig } from "@/contexts/SiteConfigContext";
import {
  Menu,
  X,
  ShoppingCart,
  LogIn,
  User,
  LogOut,
  Package,
  ChevronDown,
  Users,
  Beaker,
  Microscope,
  LayoutDashboard,
  Warehouse,
} from "lucide-react";
import { siteConfig } from "@/lib/config";
import { canAccessAdmin, canAccessWarehouse } from "@/lib/permissions";
import Link from "next/link";
import PeptideLoader from "./PeptideLoader";
import BrandLockup from "./BrandLockup";
import AdDiscountNotice, { useAdOfferNotice } from "./AdDiscountNotice";

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const { t } = useLanguage();
  const { totalItems, bumpKey } = useCart();
  const { customer, logout } = useCustomer();
  const { affiliate } = useAffiliate();
  const { config } = useSiteConfig();

  const router = useRouter();
  const pathname = usePathname();
  const dropdownTimeout = useRef<NodeJS.Timeout | null>(null);

  // On the homepage the nav starts transparent over the video hero and
  // solidifies to white once the page scrolls (or the mobile menu opens).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const overlay = pathname === "/" && !scrolled && !isOpen;

  // The paid-ads welcome offer shares the research-disclaimer row. On a phone
  // that row is already the width of the screen, so it gives up "Canada Only"
  // to make space rather than wrapping — a second line would make the fixed nav
  // taller than the literal top padding each storefront screen sets aside.
  const adOffer = useAdOfferNotice();

  const desktopLinkCls = `px-4 py-2 rounded-lg transition-all text-sm font-medium ${
    overlay
      ? "text-white/80 hover:text-white hover:bg-white/10"
      : "text-ink-muted hover:text-ink hover:bg-surface"
  }`;

  // Staff (admin / assistant / affiliate) get a shortcut into the admin
  // dashboard from the customer-facing account menu.
  const isStaff = !!customer && canAccessAdmin(customer.role);
  // Warehouse staff (and admins, for oversight) get a shortcut into the
  // fulfillment portal at /warehouse.
  const isWarehouse = !!customer && canAccessWarehouse(customer.role);

  const handleMouseEnter = (dropdown: string) => {
    if (dropdownTimeout.current) {
      clearTimeout(dropdownTimeout.current);
    }
    setActiveDropdown(dropdown);
  };

  const handleMouseLeave = () => {
    dropdownTimeout.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 150);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    setActiveDropdown(null);
    setIsOpen(false);
    await logout();
    setTimeout(() => {
      router.replace("/");
      // Navigation does not unmount when redirecting to a route we may
      // already be on, so clear the loading flag ourselves — otherwise the
      // "Signing out..." loader stays on screen indefinitely.
      setLoggingOut(false);
    }, 1200);
  };

  if (loggingOut) {
    return <PeptideLoader message="Signing out..." type="logout" />;
  }

  return (
    <nav className="fixed top-0 w-full z-50">
      {/* Main Navigation Bar */}
      <div
        className={`transition-colors duration-300 ${
          overlay ? "bg-transparent border-b border-transparent" : "bg-white border-b border-line"
        }`}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="flex justify-between items-center h-[72px]">
            {/* Logo */}
            <Link href="/" className="group flex items-center" aria-label={config.store_name}>
              <BrandLockup
                name={config.store_name}
                tagline={config.store_tagline}
                logoUrl={config.logo_url}
                tone={overlay ? "dark" : "light"}
                size="md"
                className="transition-opacity duration-300 group-hover:opacity-90"
              />
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              <Link
                href="/"
                className={desktopLinkCls}
              >
                Home
              </Link>

              <Link
                href="/products"
                className={desktopLinkCls}
              >
                Products
              </Link>

              <Link
                href="/lab-results"
                className={desktopLinkCls}
              >
                Lab Results
              </Link>

              {/* Company Dropdown */}
              <div
                className="relative z-[60]"
                onMouseEnter={() => handleMouseEnter("company")}
                onMouseLeave={handleMouseLeave}
              >
                <button
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                    activeDropdown === "company"
                      ? overlay
                        ? "text-white bg-white/10"
                        : "text-ink bg-surface"
                      : overlay
                        ? "text-white/80 hover:text-white hover:bg-white/10"
                        : "text-ink-muted hover:text-ink hover:bg-surface"
                  }`}
                >
                  <span>Company</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === "company" ? "rotate-180" : ""}`}
                  />
                </button>

                <AnimatePresence>
                  {activeDropdown === "company" && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="absolute left-0 top-full pt-2 w-64 z-[100]"
                    >
                      <div className="bg-white rounded-2xl shadow-2xl shadow-black/20 overflow-hidden border border-slate-200">
                        <div className="p-2">
                          <div className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-not-allowed opacity-50">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                              <Users className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-400">
                                About Us
                              </p>
                              <p className="text-xs text-slate-400">
                                Coming Soon
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-not-allowed opacity-50">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                              <Microscope className="w-5 h-5 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-400">
                                Certifications
                              </p>
                              <p className="text-xs text-slate-400">
                                Coming Soon
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Link
                href="/contact"
                className={desktopLinkCls}
              >
                Contact
              </Link>

              {siteConfig.ecommerceEnabled && (
                <Link
                  href={affiliate ? "/affiliate/dashboard" : "/affiliate/signup"}
                  className={`px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                    overlay
                      ? "text-teal-light hover:text-teal-light hover:bg-white/10"
                      : "text-teal-dark hover:text-teal-dark hover:bg-teal-50"
                  }`}
                >
                  {affiliate ? "My Affiliate" : "Affiliates"}
                </Link>
              )}
            </div>

            {/* Right Side Actions */}
            <div className="hidden lg:flex items-center gap-2">
              {/* Cart */}
              {siteConfig.ecommerceEnabled && (
                <Link
                  href="/cart"
                  data-cart-target
                  aria-label={`Cart${totalItems > 0 ? `, ${totalItems} item${totalItems === 1 ? '' : 's'}` : ''}`}
                  className={`relative flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
                    overlay
                      ? "text-white/80 hover:text-white hover:bg-white/10"
                      : "text-ink-muted hover:text-ink hover:bg-surface"
                  }`}
                >
                  <motion.span
                    key={bumpKey}
                    animate={bumpKey > 0 ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <ShoppingCart className="w-5 h-5" />
                  </motion.span>
                  {totalItems > 0 && (
                    <span
                      className={`absolute -top-0.5 -right-0.5 text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1 transition-colors duration-300 ${
                        overlay ? "bg-white text-ink" : "bg-ink text-white"
                      }`}
                    >
                      {totalItems > 99 ? "99+" : totalItems}
                    </span>
                  )}
                </Link>
              )}

              {/* Divider */}
              {siteConfig.authEnabled && (
                <div className={`w-px h-6 mx-1 transition-colors duration-300 ${overlay ? "bg-white/25" : "bg-line"}`} />
              )}

              {/* Login/Account */}
              {siteConfig.authEnabled && customer ? (
                <div
                  className="relative z-[60]"
                  onMouseEnter={() => handleMouseEnter("account")}
                  onMouseLeave={handleMouseLeave}
                >
                  <button
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all text-sm font-medium ${
                      activeDropdown === "account"
                        ? overlay
                          ? "bg-white/90 text-ink"
                          : "bg-surface text-ink"
                        : overlay
                          ? "bg-white text-ink hover:bg-white/90"
                          : "bg-ink text-white hover:bg-ink/90"
                    }`}
                  >
                    <User className="w-4 h-4" />
                    <span>{customer.first_name}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === "account" ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence>
                    {activeDropdown === "account" && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute right-0 top-full pt-2 w-52 z-[100]"
                      >
                        <div className="bg-white rounded-xl shadow-2xl shadow-black/20 overflow-hidden border border-slate-200">
                          {isStaff && (
                            <div className="p-2 border-b border-slate-100">
                              <Link
                                href="/admin"
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-teal-50 transition-colors text-teal-dark"
                                onClick={() => setActiveDropdown(null)}
                              >
                                <LayoutDashboard className="w-4 h-4" />
                                <span className="text-sm font-semibold">
                                  Admin Dashboard
                                </span>
                              </Link>
                            </div>
                          )}
                          {isWarehouse && (
                            <div className="p-2 border-b border-slate-100">
                              <Link
                                href="/warehouse"
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-teal-50 transition-colors text-teal-dark"
                                onClick={() => setActiveDropdown(null)}
                              >
                                <Warehouse className="w-4 h-4" />
                                <span className="text-sm font-semibold">
                                  Warehouse
                                </span>
                              </Link>
                            </div>
                          )}
                          <div className="p-2">
                            <Link
                              href="/account/dashboard"
                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
                              onClick={() => setActiveDropdown(null)}
                            >
                              <Package className="w-4 h-4 text-slate-500" />
                              <span className="text-sm font-medium">
                                My Orders
                              </span>
                            </Link>
                          </div>
                          <div className="border-t border-slate-100 p-2">
                            <button
                              onClick={handleLogout}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-red-50 transition-colors text-slate-700 hover:text-red-600"
                            >
                              <LogOut className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                Sign Out
                              </span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : siteConfig.authEnabled ? (
                <Link
                  href="/login"
                  className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                    overlay
                      ? "bg-white hover:bg-white/90 text-ink"
                      : "bg-ink hover:bg-ink/90 text-white"
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>Login</span>
                </Link>
              ) : null}
            </div>

            {/* Mobile: Cart + Menu */}
            <div className="lg:hidden flex items-center gap-2">
              {siteConfig.ecommerceEnabled && (
                <Link
                  href="/cart"
                  data-cart-target
                  aria-label={`Cart${totalItems > 0 ? `, ${totalItems} item${totalItems === 1 ? '' : 's'}` : ''}`}
                  className={`relative flex items-center justify-center w-10 h-10 transition-colors ${
                    overlay ? "text-white/80 hover:text-white" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <motion.span
                    key={bumpKey}
                    animate={bumpKey > 0 ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="flex items-center justify-center"
                  >
                    <ShoppingCart className="w-5 h-5" />
                  </motion.span>
                  {totalItems > 0 && (
                    <span
                      className={`absolute -top-0.5 -right-0.5 text-[10px] rounded-full min-w-[18px] h-[18px] flex items-center justify-center font-bold px-1 transition-colors duration-300 ${
                        overlay ? "bg-white text-ink" : "bg-ink text-white"
                      }`}
                    >
                      {totalItems > 99 ? "99+" : totalItems}
                    </span>
                  )}
                </Link>
              )}
              <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-center w-10 h-10 transition-colors ${
                  overlay ? "text-white/80 hover:text-white" : "text-ink-muted hover:text-ink"
                }`}
              >
                {isOpen ? (
                  <X className="w-6 h-6" />
                ) : (
                  <Menu className="w-6 h-6" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Research Disclaimer - Now inside the main nav container */}
        <div
          className={`text-center py-2 sm:py-1.5 transition-colors duration-300 ${
            overlay ? "bg-transparent border-t border-white/10" : "bg-surface border-t border-line"
          }`}
        >
          <span
            className={`text-[10px] sm:text-[11px] tracking-wide inline-flex items-center justify-center gap-1.5 sm:gap-2 px-4 transition-colors duration-300 ${
              overlay ? "text-white/60" : "text-ink-muted"
            }`}
          >
            <Beaker className={`w-3 h-3 flex-shrink-0 ${overlay ? "text-teal-light" : "text-teal-dark"}`} />
            <span>Research Only</span>
            <span className={`hidden sm:inline ${overlay ? "text-white/25" : "text-line"}`}>•</span>
            <span className="hidden sm:inline">Shipping to Canada Only</span>
            <span className={adOffer.show ? "hidden" : "sm:hidden"}>• Canada Only</span>

            {/* Paid-ads welcome offer, for visitors who arrived on an ad.
                Renders nothing otherwise, and never a row of its own. */}
            <AdDiscountNotice overlay={overlay} />
          </span>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden bg-white border-b border-line overflow-hidden"
          >
            <div className="px-5 py-4 space-y-1">
              <Link
                href="/"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Home
              </Link>
              <Link
                href="/products"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Products
              </Link>
              <Link
                href="/lab-results"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Lab Results
              </Link>

              {/* Company Section */}
              <div className="pt-2 pb-1">
                <p className="px-4 text-[10px] text-ink-muted uppercase tracking-[0.15em] font-medium mb-2">
                  Company
                </p>
                <div className="flex items-center gap-3 px-4 py-3 text-ink-light rounded-xl cursor-not-allowed opacity-50">
                  <Users className="w-4 h-4 text-ink-light" />
                  <span className="text-sm font-medium">About Us</span>
                  <span className="text-[10px] text-ink-muted ml-auto">
                    Coming Soon
                  </span>
                </div>
                <div className="flex items-center gap-3 px-4 py-3 text-ink-light rounded-xl cursor-not-allowed opacity-50">
                  <Microscope className="w-4 h-4 text-ink-light" />
                  <span className="text-sm font-medium">Certifications</span>
                  <span className="text-[10px] text-ink-muted ml-auto">
                    Coming Soon
                  </span>
                </div>
              </div>

              <Link
                href="/contact"
                className="block px-4 py-3 text-ink-muted hover:text-ink hover:bg-surface rounded-xl transition-colors text-sm font-medium"
                onClick={() => setIsOpen(false)}
              >
                Contact
              </Link>

              {siteConfig.ecommerceEnabled && (
                <Link
                  href={affiliate ? "/affiliate/dashboard" : "/affiliate/signup"}
                  className="block px-4 py-3 text-teal-dark hover:bg-teal-50 rounded-xl transition-colors text-sm font-medium"
                  onClick={() => setIsOpen(false)}
                >
                  {affiliate ? "My Affiliate" : "Affiliate Program"}
                </Link>
              )}

              {/* Auth */}
              {siteConfig.authEnabled && (
                <div className="pt-4 mt-2 border-t border-line space-y-4">
                  <div className="px-4">
                    {customer ? (
                      <div className="space-y-2">
                        {isStaff && (
                          <Link
                            href="/admin"
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-dark text-white text-sm font-semibold rounded-xl"
                            onClick={() => setIsOpen(false)}
                          >
                            <LayoutDashboard className="w-4 h-4" />
                            Admin Dashboard
                          </Link>
                        )}
                        {isWarehouse && (
                          <Link
                            href="/warehouse"
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-teal-dark text-white text-sm font-semibold rounded-xl"
                            onClick={() => setIsOpen(false)}
                          >
                            <Warehouse className="w-4 h-4" />
                            Warehouse
                          </Link>
                        )}
                        <Link
                          href="/account/dashboard"
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white text-sm font-semibold rounded-xl"
                          onClick={() => setIsOpen(false)}
                        >
                          <User className="w-4 h-4" />
                          My Account
                        </Link>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface text-ink-muted text-sm font-medium rounded-xl hover:bg-surface-2 transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </div>
                    ) : (
                      <Link
                        href="/login"
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ink text-white text-sm font-semibold rounded-xl"
                        onClick={() => setIsOpen(false)}
                      >
                        <LogIn className="w-4 h-4" />
                        Login / Sign Up
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
