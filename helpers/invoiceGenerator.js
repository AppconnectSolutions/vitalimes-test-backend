import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";

// Generate PDF from order + products
export async function generateInvoicePDF(order) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  const logoPath = "D:/New folder (2)/vitalimes/vitalimes/public/assets/images/vita_logo.svg";
const signPath = "D:/New folder (2)/vitalimes/vitalimes/public/assets/images/vita_signature.png";

  // Ensure invoices folder exists
  const invoicesDir = path.join("invoices");
  if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

  const invoicePath = path.join(invoicesDir, `${order.invoice_no || order.order_no}.pdf`);

  // Parse products
  let items = [];
  let hsn = "";
  const GST_RATE = 5;

  try {
    const raw = JSON.parse(order.products_json || "[]");

    if (raw.length > 0 && raw[0].hsn) hsn = raw[0].hsn;

    items = raw.map((p, idx) => {
      const qty = Number(p.qty || 1);
      const grossUnit = Number(p.sale_price || p.price || 0);
      const netUnit = +(grossUnit * (100 / (100 + GST_RATE))).toFixed(2);
      const taxUnit = +(grossUnit - netUnit).toFixed(2);
      const netAmount = +(netUnit * qty).toFixed(2);
      const taxAmount = +(taxUnit * qty).toFixed(2);
      const totalAmount = +(grossUnit * qty).toFixed(2);

      const parts = [];
      if (p.title) parts.push(p.title);
      if (p.weight) parts.push(p.weight);
      if (p.hsn) parts.push(`HSN:${p.hsn}`);

      return {
        sl: idx + 1,
        description: parts.join(" | "),
        qty,
        unitPrice: grossUnit,
        netAmount,
        taxRate: GST_RATE,
        taxType: "IGST",
        taxAmount,
        totalAmount,
      };
    });
  } catch (e) {
    console.error("PRODUCTS_JSON PARSE ERROR:", e);
  }

  if (!items.length) {
    const gross = Number(order.total_amount || 0);
    const net = +(gross * (100 / 105)).toFixed(2);
    const tax = +(gross - net).toFixed(2);
    items = [
      {
        sl: 1,
        description: "Items",
        qty: order.quantity || 1,
        unitPrice: gross,
        netAmount: net,
        taxRate: GST_RATE,
        taxType: "IGST",
        taxAmount: tax,
        totalAmount: gross,
      },
    ];
  }

  const totalTax = items.reduce((s, it) => s + it.taxAmount, 0);
  const grandTotal = items.reduce((s, it) => s + it.totalAmount, 0);

  // Convert amount to words
  const numberToWords = (num) => {
    num = Math.round(Number(num || 0));
    if (num === 0) return "Zero only";
    const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
    const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
    const belowThousand = (n) => {
      let str = "";
      if(n>99){str += ones[Math.floor(n/100)]+" Hundred "; n=n%100;}
      if(n>19){str += tens[Math.floor(n/10)]+" "; n=n%10;}
      if(n>0) str += ones[n]+" ";
      return str.trim();
    };
    let result="";
    const crore = Math.floor(num/10000000);
    const lakh = Math.floor((num/100000)%100);
    const thousand = Math.floor((num/1000)%100);
    const hundred = num%100;
    if(crore) result+=belowThousand(crore)+" Crore ";
    if(lakh) result+=belowThousand(lakh)+" Lakh ";
    if(thousand) result+=belowThousand(thousand)+" Thousand ";
    if(hundred) result+=belowThousand(hundred);
    return result.trim()+" only";
  };

  const amountInWords = numberToWords(grandTotal);

  // HTML for invoice
  const html = `
  <div style="width:100%; max-width:700px; margin:0 auto; font-family: Arial, sans-serif; font-size:11px; color:#000; padding:10px 15px; border:1px solid #ccc;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
      <div><img src="file://${logoPath}" alt="Logo" style="height:80px;"></div>
      <div style="text-align:right;">
        <div style="font-weight:bold; font-size:14px;">Tax Invoice/Bill of Supply/Cash Memo</div>
        <div style="font-size:10px;">(For Supplier)</div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; margin-top:10px;">
      <div style="width:55%;">
        <div style="font-weight:bold; margin-bottom:3px;">Sold By :</div>
        <div>
          VITALIME AGRO TECH PRIVATE LIMITED<br>
          5/109, Meenakshi Nagar, Alampatti<br>
          Thoothukudi, TAMIL NADU, 628503<br>
          INDIA
        </div>
        <div style="margin-top:10px;">
          ${hsn? `<div><span style="font-weight:bold">HSN Code:</span> ${hsn}</div>`: ""}
          <div><span style="font-weight:bold">PAN No:</span> AAJCV8259L</div>
          <div><span style="font-weight:bold">GST Registration No:</span> 33AAJCV8259L1ZN</div>
        </div>
        <div style="margin-top:10px;">
          <div style="font-weight:bold">FSSAI License No.</div>
          <div>12422029000832</div>
        </div>
      </div>

      <div style="width:40%; text-align:right;">
        <div style="font-weight:bold; margin-bottom:3px;">Billing Address :</div>
        <div>
          ${order.name}<br>
          ${order.address}<br>
          ${order.city}, ${order.state}, ${order.pin}<br>
          ${order.country}<br>
          <span style="font-weight:bold">Mobile:</span> ${order.mobile}
        </div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:5px; font-size:11px;">
      <div>
        <div><span style="font-weight:bold">Order Number:</span> ${order.order_no}</div>
        <div><span style="font-weight:bold">Order Date:</span> ${new Date(order.order_date).toLocaleDateString("en-IN")}</div>
      </div>
      <div style="text-align:right;">
        <div><span style="font-weight:bold">Invoice Number:</span> ${order.invoice_no || "Not assigned"}</div>
        <div><span style="font-weight:bold">Invoice Date:</span> ${new Date(order.order_date).toLocaleDateString("en-IN")}</div>
      </div>
    </div>

    <table style="width:100%; border-collapse:collapse; margin-top:10px;" border="1" cellpadding="4">
      <thead>
        <tr style="background:#f2f2f2; font-weight:bold;">
          <th style="width:5%; text-align:center;">Sl. No</th>
          <th style="width:35%;">Description</th>
          <th style="width:10%; text-align:right;">Unit Price</th>
          <th style="width:7%; text-align:center;">Qty</th>
          <th style="width:10%; text-align:right;">Net Amount</th>
          <th style="width:8%; text-align:center;">Tax Rate</th>
          <th style="width:8%; text-align:center;">Tax Type</th>
          <th style="width:10%; text-align:right;">Tax Amount</th>
          <th style="width:10%; text-align:right;">Total Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td style="text-align:center">${it.sl}</td>
            <td>${it.description}</td>
            <td style="text-align:right">₹${it.unitPrice.toFixed(2)}</td>
            <td style="text-align:center">${it.qty}</td>
            <td style="text-align:right">₹${it.netAmount.toFixed(2)}</td>
            <td style="text-align:center">${it.taxRate}%</td>
            <td style="text-align:center">${it.taxType}</td>
            <td style="text-align:right">₹${it.taxAmount.toFixed(2)}</td>
            <td style="text-align:right">₹${it.totalAmount.toFixed(2)}</td>
          </tr>
        `).join("")}
        <tr style="font-weight:bold;">
          <td colspan="7" style="text-align:right;">TOTAL:</td>
          <td style="text-align:right">₹${totalTax.toFixed(2)}</td>
          <td style="text-align:right">₹${grandTotal.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:10px; border-top:1px solid #000;">
      <div style="margin-top:8px;"><span style="font-weight:bold">Amount in Words:</span><br>${amountInWords}</div>
      <div style="display:flex; justify-content:space-between; margin-top:30px; align-items:flex-end;">
        <div><span style="font-weight:bold">Whether tax is payable under reverse charge -</span> No</div>
        <div style="text-align:right;">
          <div style="font-weight:bold;">For VITALIME AGRO TECH PRIVATE LIMITED:</div>
          <div style="margin-top:6px; margin-bottom:2px;"><img src="file://${signPath}" alt="Authorized Signatory" style="height:35px;"></div>
          <div style="margin-top:2px; padding-top:4px; font-style:italic; font-weight:bold;">Authorized Signatory</div>
        </div>
      </div>
    </div>

    <div style="margin-top:15px; text-align:center; font-size:9px; color:#555;">
      Invoice generated by AppConnect Solutions
    </div>
  </div>
  `;

  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({
    path: invoicePath,
    format: "A4",
    printBackground: true,
    margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
  });

  await browser.close();
  return invoicePath;
}
