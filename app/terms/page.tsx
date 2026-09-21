import React from 'react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Terms & Conditions | VYTA',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white">
      <Navigation />

      <div className="pt-32 sm:pt-36 md:pt-44 pb-16 sm:pb-20 md:pb-28">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 lg:px-12">
          <div className="mb-10">
            <h1 className="text-3xl sm:text-4xl font-bold text-ink mb-3">Terms &amp; Conditions</h1>
            <p className="text-ink-muted text-sm">
              These terms and conditions govern all users of VYTA and{' '}
              <span className="font-medium text-ink">aminocan.com</span>. These must be agreed upon before any
              purchases can be made.
            </p>
          </div>

          <div className="space-y-8 text-sm text-ink leading-relaxed">

            <p>
              The products we offer are intended for laboratory research use only. In purchasing any of these
              items, the customer acknowledges that there are risks involved with consumption or distribution of
              these products. These chemicals are NOT intended to use as food additives, drugs, cosmetics,
              household chemicals or other inappropriate applications. The listing of a material on this site
              does not constitute a license to its use in infringement of any patent. All of the products will
              be handled only by qualified and properly trained professionals. All customers represent and
              warrant that through their own review and study that they are fully aware and knowledgeable about
              the following: Government regulations regarding the use of and exposure to all products.
            </p>

            <p>
              The health and safety hazards associated with the handling of the products they purchase. The
              necessity of adequately warning of the health and safety hazards associated with any products.
            </p>

            <p>
              VYTA reserves the right to limit and/or deny sales of products to any unqualified individuals
              if we have reason to believe that misuse will occur. All customers MUST be at least 19 years of
              age to purchase our products. Under no circumstances shall VYTA or any associated affiliates
              be liable for consequential damages, whether purchasers claim in contract, negligence, strict
              liability or otherwise. In direct consideration of approving the sale of any product to the
              purchaser, the purchaser agrees to indemnify and hold us harmless from all claims, expenses,
              losses and liability of any kind arising out of the purchaser&apos;s handling, possession, and/or
              use of the product whether used alone or in combination with any other substance. Any sale will
              otherwise be denied.
            </p>

            <p>
              VYTA&apos;s products are intended solely for laboratory research purposes and unless otherwise
              stated are not to be used for any other purposes, including but not limited to vitro diagnostic
              purpose, in food drugs, medical devices, or cosmetics for humans or animals or for commercial
              purposes. The purchaser agrees that the products have not been sterilized or tested by VYTA
              for safety and efficacy in food, drug, medical device, cosmetic, commercial or any other use.
            </p>

            <p>
              The purchaser expressly represents and warrants to VYTA that the purchaser will properly
              test, use, manufacture and market any products purchased from VYTA and/or materials produced
              with products purchased from aminocan.com in accordance with the practices of a reliable person
              who is experienced in the field and in strict compliance with all applicable laws and regulations,
              now and hereinafter enacted.
            </p>

            <p>
              The purchaser further warrants that any material produced with any product shall not be
              adulterated or misbranded within the meaning of the Federal Food, Drug, and Cosmetic Act and
              shall not be materials which may not, under Sections 404, 505, or 512 of the Act, be introduced
              into interstate commerce.
            </p>

            <p>
              The purchaser realizes that, since VYTA&apos;s products are, unless otherwise stated,
              intended solely for research purposes, they may not be on the Toxic Substances Control Act (TSCA)
              inventory listing. The purchaser assumes responsibility to assure that the products purchased from
              aminocan.com are approved for use under TSCA, if applicable.
            </p>

            <p>
              Purchaser has the responsibility to verify the hazards and to conduct any further research
              necessary to learn the hazards involved in using products purchased from aminocan.com. No
              products purchased from VYTA shall, unless otherwise stated, be considered to be foods,
              drugs, medical devices or cosmetics.
            </p>

            <p>
              ALL products and services offered are for RESEARCH purposes ONLY. Under NO circumstances
              shall/should ANY of these materials be used for recreational purposes nor human consumption.
              VYTA is NOT liable for ANY damages that may be caused by negligence, abuse, or ANY other
              unforeseen matter.
            </p>

            <p>
              USES AND PATENTS: The materials for sale are intended for laboratory/in-vitro and manufacturing
              use only. They are NOT for use as food additives, drugs, cosmetic, household chemicals, or other
              inappropriate applications.
            </p>

            {/* Disclaimer of Warranties */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Disclaimer of Warranties</h2>
              <div className="space-y-4">
                <p>
                  VYTA PROVIDES CONTENT ON THIS WEB SITE AS A SERVICE TO YOU, OUR CUSTOMER. THIS WEB
                  SITE CANNOT AND DOES NOT CONTAIN INFORMATION ABOUT ALL APPLICATIONS FOR PRODUCTS SOLD. IT
                  MAY NOT CONTAIN ALL INFORMATION THAT IS APPLICABLE TO YOUR PERSONAL CIRCUMSTANCES OR YOUR
                  USE OF PRODUCTS SOLD. THE CONTENT OF THIS WEB SITE, THE WEB SITE SERVER THAT MAKES IT
                  AVAILABLE, AND THE SERVICES AND PRODUCTS VYTA PROVIDES ON THIS WEB SITE, ARE
                  PROVIDED ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS WITHOUT WARRANTY OF
                  ANY KIND, WHETHER EXPRESS, IMPLIED OR STATUTORY. VYTA EXPRESSLY DISCLAIMS LIABILITY
                  FOR TECHNICAL FAILURES (INCLUDING HARDWARE OR SOFTWARE FAILURES), INCOMPLETE, SCRAMBLED OR
                  DELAYED COMPUTER TRANSMISSIONS, AND/OR TECHNICAL INACCURACIES, AS WELL AS UNAUTHORIZED
                  ACCESS OF USER TRANSMISSIONS BY THIRD PARTIES. FURTHER, VYTA DOES NOT REPRESENT OR
                  WARRANT THAT NO VIRUSES OR OTHER CONTAMINATING OR DESTRUCTIVE PROPERTIES WILL BE
                  TRANSMITTED, OR THAT NO DAMAGE WILL OCCUR TO YOUR COMPUTER SYSTEM. YOU HAVE SOLE
                  RESPONSIBILITY FOR ADEQUATE PROTECTION AND BACKUP OF DATA AND/OR EQUIPMENT AND TO TAKE ALL
                  PRECAUTIONS TO SCAN FOR COMPUTER VIRUSES OR OTHER DESTRUCTIVE PROPERTIES. BY YOUR USE OF
                  THIS WEB SITE, YOU ACKNOWLEDGE THAT SUCH USE IS AT YOUR SOLE RISK, INCLUDING RESPONSIBILITY
                  FOR ALL COSTS ASSOCIATED WITH ALL NECESSARY SERVICING OR REPAIRS OF ANY EQUIPMENT YOU USE IN
                  CONNECTION WITH THIS WEB SITE.
                </p>
                <p>
                  TO THE FULL EXTENT NOT PRECLUDED BY APPLICABLE LAW VYTA, THEIR MEDICAL ADVISORS,
                  SUPPLIERS, CONSULTANTS, DIRECTORS AND EMPLOYEES DISCLAIM AND EXCLUDE ALL WARRANTIES WITH
                  RESPECT TO ALL CONTENT, EXPRESS, IMPLIED OR STATUTORY. THIS DISCLAIMER INCLUDES, BUT IS NOT
                  LIMITED TO, ANY AND ALL WARRANTIES OR MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
                  NON-INFRINGEMENT. VYTA DOES NOT WARRANT THE CONTENT TO BE ACCURATE, COMPLETE OR
                  CURRENT. VYTA DOES NOT WARRANT THAT THIS WEB SITE WILL OPERATE WITHOUT ERROR, THAT
                  DEFECTS WILL BE CORRECTED OR THAT THIS WEB SITE OR THE WEB SITE SERVER MAKING IT AVAILABLE
                  ARE FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS. PRICE AND AVAILABILITY CONTENT, AS WELL AS
                  OTHER CONTENT CONTAINED IN THIS WEB SITE OR ACCESSIBLE THEREFROM, IS SUBJECT TO CHANGE
                  WITHOUT NOTICE.
                </p>
                <p>
                  YOU ACKNOWLEDGE AND AGREE THAT VYTA DOES NOT ENDORSE THE CONTENT OF ANY SITE
                  ACCESSED VIA LINKS OR OTHER MEANS FROM THIS WEB SITE AND IT IS NOT RESPONSIBLE OR LIABLE FOR
                  SUCH CONTENT EVEN THOUGH IT MAY BE UNLAWFUL, HARASSING, LIBELOUS, PRIVACY INVADING, ABUSIVE,
                  THREATENING, HARMFUL, OBSCENE, OR OTHERWISE OBJECTIONABLE, OR THAT IT INFRINGES OR MAY
                  INFRINGE THE INTELLECTUAL PROPERTY OR OTHER RIGHTS OF ANOTHER PERSON.
                </p>
                <p>
                  THIS WEB SITE INCLUDES CONTENT PROVIDED BY THIRD PARTIES/LINKS AND YOU, OUR CUSTOMER. WE
                  HAVE NO CONTROL OVER, AND ASSUME NO RESPONSIBILITY FOR THE CONTENT, PRIVACY POLICIES, OR
                  PRACTICES OF ANY THIRD-PARTY WEBSITES OR SERVICES. YOU FURTHER ACKNOWLEDGE AND AGREE THAT
                  VYTA SHALL NOT BE RESPONSIBLE OR LIABLE, DIRECTLY OR INDIRECTLY FOR ANY DAMAGE OR
                  LOSS CAUSED BY OR IN CONNECTION WITH THE USE OF OR RELIANCE ON ANY SUCH CONTENT, GOODS, OR
                  SERVICES AVAILABLE ON OR THROUGH ANY SUCH WEBSITES OR SERVICES.
                </p>
              </div>
            </section>

            {/* Entire Agreement */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Entire Agreement</h2>
              <p>
                These Terms and Conditions and any terms incorporated or referred to herein constitute the
                entire agreement between VYTA and you relating to your use of this Web Site and the subject
                matter hereof, and supersede any prior understandings or agreements (whether electronic, oral or
                written) regarding the subject matter, and may not be amended or modified except in writing, or
                by VYTA making such amendments or modifications in accordance with this Terms and Conditions
                of Use Agreement.
              </p>
            </section>

            {/* Severability */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Severability</h2>
              <p>
                If any part of this Terms and Conditions of Use Agreement is deemed or determined to be
                unenforceable, then such part shall be eliminated or limited to the minimum extent necessary.
                The remainder of this Terms and Conditions of Use Agreement, including any revised portion,
                shall remain and be in full force and effect. This Terms and Conditions of Use Agreement are the
                entire agreement between us governing your use of this Web Site.
              </p>
            </section>

            {/* Complete Agreement */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Complete Agreement</h2>
              <p>
                Except as expressly provided in a particular &ldquo;legal notice&rdquo; on this Site, these
                Terms and Conditions constitute the entire agreement between you and this Site with respect to
                the use of this Site, and Content. By clicking &ldquo;I agree&rdquo; when placing your order,
                you agree with ALL OF OUR TERMS and CONDITIONS as stated above as well as our Shipping and
                Refunds Policy.
              </p>
              <p className="mt-3">
                We strongly advise you to read the terms and conditions and privacy policies of any third-party
                websites or services that you visit. VYTA IS A DISTRIBUTOR OF SUCH CONTENT AND NOT ITS
                PUBLISHER. VYTA&apos;S EDITORIAL CONTROL OF SUCH CONTENT IS THE SAME AS THAT OF A
                PUBLIC LIBRARY OR NEWSSTAND. VYTA&apos;S THIRD PARTY SUPPLIERS MAY EXPRESS CERTAIN
                OPINIONS OR PROVIDE CERTAIN INFORMATION AND OFFERS. VYTA MAKES NO WARRANTIES AS TO THE
                COMPLETENESS, ACCURACY, TIMELINESS, OR RELIABILITY OF INFORMATION OR OFFERS SUPPLIED BY THIRD
                PARTIES. VYTA DOES NOT GUARANTEE OR WARRANT THE PERFORMANCE OF ANY THIRD PARTY,
                INCLUDING ANY SUCH THIRD PARTY&apos;S CONFORMANCE TO ANY LAW, RULE, REGULATION OR POLICY.
              </p>
              <p className="mt-3">
                VYTA DOES NOT WARRANT THAT INFORMATION, SERVICES, AND PRODUCTS CONTAINED IN THIS WEB
                SITE WILL SATISFY YOUR REQUIREMENTS OR THAT THEY ARE ERROR OR DEFECT-FREE. BEFORE USING ANY
                PRODUCT YOU SHOULD CONFIRM ANY INFORMATION OF IMPORTANCE TO YOU ON THE PRODUCT PACKAGING. YOU
                ASSUME RESPONSIBILITY FOR THE ACCURACY, APPROPRIATENESS AND LEGALITY OF ANY INFORMATION YOU
                SUPPLY VYTA.
              </p>
              <p className="mt-3">
                AS PARTIAL CONSIDERATION FOR YOUR ACCESS TO THIS WEB SITE AND USE OF ITS CONTENT, YOU AGREE
                THAT VYTA IS NOT LIABLE TO YOU IN ANY MANNER WHATSOEVER FOR DECISIONS YOU MAY MAKE OR
                YOUR ACTIONS OR NON-ACTIONS IN RELIANCE UPON THE CONTENT. YOU ALSO AGREE THAT THE AGGREGATE
                LIABILITY OF VYTA ARISING FROM OR RELATED TO YOUR USE AND ACCESS REGARDLESS OF THE FORM
                OF ACTION OR CLAIM (FOR EXAMPLE, CONTRACT, WARRANTY, TORT, NEGLIGENCE, STRICT LIABILITY,
                PROFESSIONAL MALPRACTICE, FRAUD, OR OTHER BASES FOR CLAIMS), IS LIMITED TO THE PURCHASE PRICE
                OF ANY ITEMS YOU PURCHASED FROM VYTA IN THE APPLICABLE TRANSACTION. VYTA SHALL
                NOT IN ANY CASE BE LIABLE FOR ANY DIRECT, INDIRECT, SPECIAL, INCIDENTAL, CONSEQUENTIAL, OR
                PUNITIVE DAMAGES EVEN IF VYTA HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
                THIS IS A COMPREHENSIVE LIMITATION OF LIABILITY THAT APPLIES TO ALL LOSSES AND DAMAGES OF ANY
                KIND. IF YOU ARE DISSATISFIED WITH THIS WEB SITE OR ITS CONTENT (INCLUDING TERMS OF USE), YOUR
                SOLE EXCLUSIVE REMEDY IS TO DISCONTINUE USING THIS WEB SITE.
              </p>
            </section>

            {/* Disclaimer */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Disclaimer</h2>
              <div className="space-y-3">
                <p className="font-semibold">YOU MUST BE OVER 19 YEARS OLD TO USE THIS WEBSITE.</p>
                <p>
                  The products we offer are intended for IN-VITRO LABORATORY RESEARCH USE ONLY. The products
                  are NOT FOR HUMAN or ANIMAL USE OR CONSUMPTION OF ANY KIND.
                </p>
                <p>
                  The products offered on this website are NOT INTENDED TO DIAGNOSE, CURE, MITIGATE, TREAT or
                  PREVENT DISEASE.
                </p>
                <p>
                  In purchasing any of these items, the customer acknowledges and assumes that there are risks
                  involved with consumption or distribution of these products.
                </p>
                <p>
                  These research supplies are NOT intended to use as food additives, drugs, household chemicals
                  or other inappropriate applications.
                </p>
                <p>
                  The listing of a material on this site does not constitute a license to its use in
                  infringement of any patent.
                </p>
                <p>
                  All of the products will be handled only by qualified and properly trained RESEARCH or
                  LABORATORY professionals only.
                </p>
                <p>Due to the nature of these products, ALL SALES ARE FINAL. WE CANNOT ACCEPT RETURNS.</p>
                <p>
                  All customers represent and warrant that through their own review and study that they are
                  fully aware and knowledgeable about the following:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Use of the products and more specifically In-vitro Research use of the products.</li>
                  <li>
                    Your specific country&apos;s Government regulations regarding the use of and exposure to
                    all products.
                  </li>
                  <li>
                    The health and safety hazards associated with the handling of the products they purchase.
                  </li>
                  <li>
                    The necessity of adequately warning of the health and safety hazards associated with any
                    products.
                  </li>
                  <li>
                    All products are sold for research, laboratory, or analytical purposes only, and are not
                    for human consumption.
                  </li>
                </ul>
                <p>
                  VYTA reserves the right to limit and/or deny sales of products to any unqualified
                  individuals. All customers MUST be at least 19 years of age to purchase our products. IN NO
                  CIRCUMSTANCE SHALL VYTA BE LIABLE FOR INCIDENTAL OR CONSEQUENTIAL DAMAGES, WHETHER
                  PURCHASER&apos;S CLAIM IN CONTRACT, NEGLIGENCE, STRICT LIABILITY OR OTHERWISE. IN DIRECT
                  CONSIDERATION OF APPROVING THE SALE OF ANY PRODUCT TO THE PURCHASER, THE PURCHASER AGREES TO
                  INDEMNIFY AND HOLD US HARMLESS FROM ALL CLAIMS, EXPENSES, LOSSES AND LIABILITY OF ANY TYPE
                  ARISING OUT OF THE PURCHASER&apos;S HANDLING, POSSESSION, AND/OR USE OF THE PRODUCT, WHETHER
                  USED ALONE OR IN COMBINATION WITH ANY SUBSTANCE. ANY SALE WOULD BE DENIED OTHERWISE.
                </p>
              </div>
            </section>

            {/* Product Use */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Product Use</h2>
              <div className="space-y-3">
                <p>
                  VYTA products are intended for laboratory IN-VITRO RESEARCH PURPOSES ONLY — NOT FOR
                  HUMAN or ANIMAL USE or CONSUMPTION of any kind and are not to be used for any other purposes,
                  including but not limited to food and/or drugs, medical devices, vitro diagnostic purpose, or
                  for commercial purposes. The purchaser agrees that the products have not been sterilized or
                  tested by VYTA for safety and efficacy in food, drug, medical device, cosmetic,
                  commercial or any other use.
                </p>
                <p>
                  The purchaser expressly represents and warrants to VYTA that the purchaser will properly
                  test, use, manufacture and market any products purchased from VYTA and/or materials
                  produced with products purchased from VYTA in accordance with the practices of a reliable
                  person who is experienced in the field and in strict compliance with all applicable laws and
                  regulations, now and hereinafter enacted.
                </p>
                <p>
                  The purchaser further warrants that any material produced with any product shall not be
                  adulterated or misbranded within the meaning of the Federal Food, Drug, and Cosmetic Act and
                  shall not be materials which may not, under Sections 404, 505, or 512 of the Act, be
                  introduced into interstate commerce.
                </p>
                <p>
                  The purchaser realizes and agrees that, since VYTA products are, unless otherwise stated,
                  intended solely for in-vitro research purposes, they may not be on the Toxic Substances
                  Control Act (TSCA) inventory listing. The purchaser assumes responsibility to assure that the
                  products purchased from VYTA are approved for use under TSCA, if applicable.
                </p>
                <p>
                  Purchaser has the responsibility to verify the hazards and to conduct any further research
                  necessary to learn the hazards involved in using products purchased from aminocan.com. No
                  products purchased from aminocan.com shall, unless otherwise stated, be considered to be
                  foods, drugs, medical devices or cosmetics. ALL products and services offered are for
                  RESEARCH purposes ONLY. Under NO circumstances shall/should ANY of these materials be used
                  for therapeutic or diagnostic purposes. VYTA is NOT liable for ANY damages that may be
                  caused by negligence, abuse, or ANY other unforeseen matter.
                </p>
                <p>
                  USES AND PATENTS: The materials for sale are intended for laboratory and manufacturing use
                  only. They are NOT for use as food additives, drugs, cosmetic, household chemicals, or other
                  inappropriate applications. YOU MUST BE A MINIMUM OF 19 YEARS OF AGE. The listing of a
                  material in this catalog does not constitute a license to, or a recommendation for, its use
                  in infringement of any patent.
                </p>
                <p>
                  In purchasing these products, the customer acknowledges that there are hazards associated
                  with their use. Customer represents and warrants to us that from customer&apos;s own
                  independent review and study they are fully aware and knowledgeable about the following:
                </p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>
                    (I) the health and safety hazards associated with the handling of the products purchased;
                  </li>
                  <li>
                    (II) Industrial hygiene controls necessary to protect its workers from such health and
                    safety hazards;
                  </li>
                  <li>
                    (III) The need to adequately warn of health and safety hazards associated with products;
                    and
                  </li>
                  <li>
                    (IV) Government regulations regarding the use of and exposure to such products. We reserve
                    the right to limit sales of products or not to sell products to unqualified customers.
                  </li>
                </ul>
                <p>
                  In no event shall VYTA be liable for special, incidental or consequential damages,
                  whether purchasers claim in contract, strict liability or otherwise. In consideration of the
                  sale of products to purchaser, which sales we would not otherwise make, purchaser agrees to
                  indemnify and hold VYTA harmless from all claims, expenses, losses and liability of any
                  nature whatsoever arising out of purchasers handling and/or use of purchased product.
                </p>
                <p>
                  All users of aminocan.com are required to fully understand that any communication which leads
                  us to believe that you will use these products in a manner other than that which they are
                  intended will result in a refusal to sell alert being emailed to you and placed on your
                  account. We will absolutely under no circumstances tolerate the misuse of aminocan.com or the
                  products contained/sold herein.
                </p>
                <p>
                  VYTA assumes that the researcher is familiar with the products being purchased. We do not
                  provide any type of guidelines or suggestions regarding reconstitution of peptides or their
                  application to your research. Please familiarize yourself with all products and their
                  research purposes prior to purchasing.
                </p>
                <p>
                  The purchaser warrants that they are affiliated with a laboratory, institution, university or
                  other research based facility which warrants the purchase and use of products sold by
                  VYTA, for research purposes only. Furthermore, should anyone purchase from VYTA that
                  does not have said affiliations, they will be committing a fraudulent act for which they
                  could be held liable.
                </p>
                <p>
                  VYTA reserves the right to perform due diligence screening upon the information provided
                  to check for accuracy. VYTA, at its sole discretion, may require further verification of
                  affiliation prior to order fulfillment.
                </p>
                <p>
                  Under NO circumstances shall/should ANY of these materials be used for recreational purposes
                  nor human consumption of any kind. VYTA is NOT liable for ANY damages that may be caused
                  by negligence, abuse, or ANY other unforeseen matter.
                </p>
              </div>
            </section>

            {/* Governing Law */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">
                Governing Law and Jurisdiction
              </h2>
              <p>
                This Web Site (excluding linked sites, if any) is administered and controlled by VYTA and
                its affiliates, subsidiaries, officers, directors, employees or agents. You agree that this
                Terms and Conditions of Use Agreement and this Web Site will be governed by and construed in
                accordance with applicable law without giving effect to any principles of conflicts of laws. You
                access this Web Site and/or associated services of VYTA at your own risk, and remain
                responsible for complying with the laws of the jurisdiction within which you are located.
              </p>
            </section>

            {/* Pricing and Payments */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">
                Pricing and Payments
              </h2>
              <p>
                I authorize VYTA to initiate a single ACH/electronic debit to my account or process payment
                via credit card or any of the other alternative payment methods offered at checkout in the
                amount of my order. I agree that ACH transactions I authorize comply with all applicable law.
                Payments made after 2pm eastern time will be applied once the payment clears our bank and
                payment has been fully submitted. To complete the payment process, click the &ldquo;Place
                Order&rdquo; button. Once payment is authorized, there cannot be any changes or corrections.
              </p>
              <p className="mt-3">
                It is recommended that you print a copy of this authorization and maintain it for your records.
              </p>
            </section>

            {/* Termination */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Termination</h2>
              <p>
                VYTA reserves the right to immediately terminate or suspend your purchase transaction
                without prior notice or liability, for any reason, including but not limited to a breach of the
                Terms of Service, product misuse, unauthorized usage, or for safety considerations.
              </p>
              <p className="mt-3">
                Upon termination, your access to our Services at aminocan.com will cease immediately. Should
                you decide to discontinue all future purchase transactions, you can achieve this by simply
                refraining from using our Service.
              </p>
            </section>

            {/* Force Majeure */}
            <section>
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Force Majeure</h2>
              <p>
                VYTA shall not be liable for any delay or failure in performance caused by circumstances
                beyond its reasonable control, including, without limitation, delays due to backorders of
                requested products, mail delays, customs delays or lost shipments. VYTA shall not be
                responsible to notify the Customer in the event of such delays. The Customer shall be solely
                responsible to make other arrangements to purchase alternative products and any costs incurred
                in connection with such purchases.
              </p>
              <p className="mt-3">
                VYTA assumes that the researcher is familiar with the products being purchased. We do not
                provide any type of guidelines or suggestions regarding reconstitution of peptides or their
                application to your research. Please familiarize yourself with all products and their research
                purposes prior to purchasing.
              </p>
              <p className="mt-3">
                This site is international and has international visitors and what may be legal in one country
                may not be legal in another. However, any information garnered from this site does not imply or
                suggest human or any use at all.
              </p>
            </section>

            {/* Contact */}
            <section className="pt-6 border-t border-line">
              <h2 className="text-base font-bold text-ink mb-3 uppercase tracking-wide">Contact</h2>
              <p>
                For questions regarding these Terms &amp; Conditions, please contact us at{' '}
                <a href="mailto:support@vytabio.com" className="text-teal-dark hover:underline font-medium">
                  support@vytabio.com
                </a>
                .
              </p>
            </section>

          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
