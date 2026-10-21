import React from 'react';
import MDXComponents from '@theme-original/MDXComponents';

function Table(props) {
  return <table tabIndex={0} {...props} />;
}

export default {...MDXComponents, table: Table};
