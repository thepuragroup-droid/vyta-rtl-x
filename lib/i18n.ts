export type Language = 'en' | 'es' | 'vi';

export interface Translations {
  nav: {
    home: string;
    products: string;
    about: string;
    contact: string;
    cart: string;
    connectWallet: string;
  };
  hero: {
    title: string;
    subtitle: string;
    cta: string;
    learnMore: string;
  };
  features: {
    title: string;
    worldwide: {
      title: string;
      description: string;
    };
    crypto: {
      title: string;
      description: string;
    };
    quality: {
      title: string;
      description: string;
    };
    fast: {
      title: string;
      description: string;
    };
  };
  products: {
    title: string;
    subtitle: string;
    viewAll: string;
    addToCart: string;
  };
  footer: {
    description: string;
    quickLinks: string;
    support: string;
    paymentMethods: string;
    copyright: string;
  };
}

export const translations: Record<Language, Translations> = {
  en: {
    nav: {
      home: 'Home',
      products: 'Products',
      about: 'About',
      contact: 'Contact',
      cart: 'Cart',
      connectWallet: 'Connect Wallet',
    },
    hero: {
      title: 'Premium Research Peptides',
      subtitle: 'Your trusted source for high-quality research peptides in Canada. Fast domestic shipping and secure payment via Interac e-Transfer.',
      cta: 'Shop Products',
      learnMore: 'Learn More',
    },
    features: {
      title: 'Why Choose VYTA Biosciences',
      worldwide: {
        title: 'Canada-Wide Shipping',
        description: 'Fast and discreet delivery to customers across Canada',
      },
      crypto: {
        title: 'Interac e-Transfer',
        description: 'Simple, secure checkout paid by Interac e-Transfer',
      },
      quality: {
        title: 'Premium Quality',
        description: '99%+ purity, third-party lab tested for your peace of mind',
      },
      fast: {
        title: 'Fast Processing',
        description: 'Orders processed within 24 hours for quick delivery',
      },
    },
    products: {
      title: 'Featured Products',
      subtitle: 'Browse our selection of research-grade peptides',
      viewAll: 'View All Products',
      addToCart: 'Add to Cart',
    },
    footer: {
      description: 'Premium research peptides with Canada-wide shipping and secure Interac e-Transfer payment.',
      quickLinks: 'Quick Links',
      support: 'Support',
      paymentMethods: 'Payment Methods',
      copyright: '© 2025 VYTA Biosciences. All rights reserved.',
    },
  },
  es: {
    nav: {
      home: 'Inicio',
      products: 'Productos',
      about: 'Acerca de',
      contact: 'Contacto',
      cart: 'Carrito',
      connectWallet: 'Conectar Billetera',
    },
    hero: {
      title: 'Péptidos de Investigación Premium',
      subtitle: 'Su fuente confiable de péptidos de investigación de alta calidad en Canadá. Envío nacional rápido y pago seguro mediante Interac e-Transfer.',
      cta: 'Ver Productos',
      learnMore: 'Saber Más',
    },
    features: {
      title: 'Por Qué Elegir VYTA Biosciences',
      worldwide: {
        title: 'Envío en Todo Canadá',
        description: 'Entrega rápida y discreta a clientes en todo Canadá',
      },
      crypto: {
        title: 'Interac e-Transfer',
        description: 'Pago sencillo y seguro mediante Interac e-Transfer',
      },
      quality: {
        title: 'Calidad Premium',
        description: 'Pureza del 99%+, probado en laboratorio externo para su tranquilidad',
      },
      fast: {
        title: 'Procesamiento Rápido',
        description: 'Pedidos procesados en 24 horas para entrega rápida',
      },
    },
    products: {
      title: 'Productos Destacados',
      subtitle: 'Explore nuestra selección de péptidos de grado investigación',
      viewAll: 'Ver Todos los Productos',
      addToCart: 'Agregar al Carrito',
    },
    footer: {
      description: 'Péptidos de investigación premium con envío en todo Canadá y pago seguro mediante Interac e-Transfer.',
      quickLinks: 'Enlaces Rápidos',
      support: 'Soporte',
      paymentMethods: 'Métodos de Pago',
      copyright: '© 2025 VYTA Biosciences. Todos los derechos reservados.',
    },
  },
  vi: {
    nav: {
      home: 'Trang Chủ',
      products: 'Sản Phẩm',
      about: 'Giới Thiệu',
      contact: 'Liên Hệ',
      cart: 'Giỏ Hàng',
      connectWallet: 'Kết Nối Ví',
    },
    hero: {
      title: 'Peptide Nghiên Cứu Cao Cấp',
      subtitle: 'Nguồn cung cấp peptide nghiên cứu chất lượng cao đáng tin cậy tại Canada. Giao hàng nội địa nhanh chóng và thanh toán an toàn qua Interac e-Transfer.',
      cta: 'Mua Sản Phẩm',
      learnMore: 'Tìm Hiểu Thêm',
    },
    features: {
      title: 'Tại Sao Chọn VYTA Biosciences',
      worldwide: {
        title: 'Giao Hàng Toàn Canada',
        description: 'Giao hàng nhanh chóng và kín đáo đến khách hàng trên toàn Canada',
      },
      crypto: {
        title: 'Interac e-Transfer',
        description: 'Thanh toán đơn giản và an toàn qua Interac e-Transfer',
      },
      quality: {
        title: 'Chất Lượng Cao Cấp',
        description: 'Độ tinh khiết 99%+, được kiểm tra bởi phòng thí nghiệm bên thứ ba',
      },
      fast: {
        title: 'Xử Lý Nhanh',
        description: 'Đơn hàng được xử lý trong vòng 24 giờ để giao hàng nhanh',
      },
    },
    products: {
      title: 'Sản Phẩm Nổi Bật',
      subtitle: 'Duyệt qua lựa chọn peptide cấp nghiên cứu của chúng tôi',
      viewAll: 'Xem Tất Cả Sản Phẩm',
      addToCart: 'Thêm Vào Giỏ',
    },
    footer: {
      description: 'Peptide nghiên cứu cao cấp với giao hàng toàn Canada và thanh toán an toàn qua Interac e-Transfer.',
      quickLinks: 'Liên Kết Nhanh',
      support: 'Hỗ Trợ',
      paymentMethods: 'Phương Thức Thanh Toán',
      copyright: '© 2025 VYTA Biosciences. Đã đăng ký bản quyền.',
    },
  },
};
