import Navigation from '@/components/Navigation';
import Hero from '@/components/Hero';
import WellnessFocus from '@/components/home/WellnessFocus';
import BestSellers from '@/components/home/BestSellers';
import ShowOurWork from '@/components/home/ShowOurWork';
import WhyChooseVyta from '@/components/home/WhyChooseVyta';
import CollectionBanner from '@/components/home/CollectionBanner';
import Testimonials from '@/components/home/Testimonials';
import ServicePromises from '@/components/home/ServicePromises';
import Footer from '@/components/Footer';

/**
 * The storefront home page, in the order the design lays it out: what we sell,
 * what sells most, why the numbers can be trusted, why us, where to start, and
 * what other customers said.
 *
 * `Testimonials` renders nothing until a quote is written in Admin →
 * Testimonials, so the page reads correctly on a brand-new store too.
 */
export default function Home() {
  return (
    <main className="min-h-screen">
      <Navigation />
      <Hero />
      <WellnessFocus />
      <BestSellers />
      <ShowOurWork />
      <WhyChooseVyta />
      <CollectionBanner />
      <Testimonials />
      <ServicePromises />
      <Footer />
    </main>
  );
}
