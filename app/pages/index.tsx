import React from "react";
import Head from "next/head";
import MainLayout from "../components/MainLayout";

const Index: React.FC = () => {
  return (
    <>
      <Head>
  <title>ShekelSync - Expense Management</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <MainLayout />
    </>
  );
};

export default Index;
