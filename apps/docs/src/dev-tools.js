if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  void import('react-grab');
  void import('react-scan').then(({scan}) => scan({enabled: true}));
}
