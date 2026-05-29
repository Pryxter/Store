import React, { useEffect, useMemo, useState } from "react";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db, firebaseConfig, hasFirebaseConfig } from "./firebase.js";

const roles = ["Dueño", "Socio", "Encargados", "Trabajador"];

const rolePermissions = {
  Dueño: { inventory: true, sales: true, history: true, users: true },
  Socio: { inventory: true, sales: true, history: true, users: false },
  Encargados: { inventory: true, sales: true, history: true, users: false },
  Trabajador: { inventory: false, sales: true, history: true, users: false },
};

const moneyFormatter = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const initialProductForm = {
  name: "",
  purchasePrice: "",
  quantity: "",
  salePrice: "",
};

const initialUserForm = {
  name: "",
  email: "",
  password: "",
  role: "Trabajador",
};

function App() {
  const [activeView, setActiveView] = useState("sales");
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [users, setUsers] = useState([]);
  const [productForm, setProductForm] = useState(initialProductForm);
  const [userForm, setUserForm] = useState(initialUserForm);
  const [saleProductId, setSaleProductId] = useState("");
  const [saleQuantity, setSaleQuantity] = useState("");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);

  const permissions = rolePermissions[profile?.role] || {};

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setAuthLoading(false);
      return undefined;
    }

    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setProfile(null);

      if (!user) {
        setAuthLoading(false);
        return;
      }

      const userSnap = await getDoc(doc(db, "users", user.uid));
      setProfile(userSnap.exists() ? { id: userSnap.id, ...userSnap.data() } : null);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!authUser || !profile) return undefined;

    const productsQuery = query(collection(db, "products"), orderBy("name"));
    const salesQuery = query(collection(db, "sales"), orderBy("createdAt", "desc"));
    const usersQuery = query(collection(db, "users"), orderBy("name"));

    const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    const unsubSales = onSnapshot(salesQuery, (snapshot) => {
      setSales(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    });

    const unsubUsers = permissions.users
      ? onSnapshot(usersQuery, (snapshot) => {
          setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        })
      : undefined;

    return () => {
      unsubProducts();
      unsubSales();
      if (unsubUsers) unsubUsers();
    };
  }, [authUser, profile, permissions.users]);

  useEffect(() => {
    if (!toast) return undefined;

    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!profile) return;

    if (!permissions[activeView]) {
      if (permissions.sales) setActiveView("sales");
      else if (permissions.inventory) setActiveView("inventory");
      else if (permissions.history) setActiveView("history");
    }
  }, [activeView, permissions, profile]);

  const availableProducts = useMemo(
    () => products.filter((product) => Number(product.quantity) > 0),
    [products]
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === saleProductId),
    [products, saleProductId]
  );

  const stats = useMemo(() => {
    const units = products.reduce((sum, product) => sum + Number(product.quantity || 0), 0);
    const inventoryValue = products.reduce(
      (sum, product) => sum + Number(product.purchasePrice || 0) * Number(product.quantity || 0),
      0
    );
    const salesTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);

    return {
      products: products.length,
      units,
      inventoryValue,
      salesTotal,
    };
  }, [products, sales]);

  const salePreview = useMemo(() => {
    if (!selectedProduct) return null;

    const quantity = Math.min(
      Number.parseInt(saleQuantity, 10) || 0,
      Number(selectedProduct.quantity || 0)
    );
    const total = Number(selectedProduct.salePrice || 0) * quantity;
    const profit =
      (Number(selectedProduct.salePrice || 0) - Number(selectedProduct.purchasePrice || 0)) *
      quantity;

    return {
      available: Number(selectedProduct.quantity || 0),
      total,
      profit,
    };
  }, [selectedProduct, saleQuantity]);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);

    try {
      await signInWithEmailAndPassword(auth, loginForm.email.trim(), loginForm.password);
      setLoginForm({ email: "", password: "" });
    } catch {
      setToast("Correo o contraseña incorrectos.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setProducts([]);
    setSales([]);
    setUsers([]);
    setActiveView("sales");
  }

  function handleProductChange(event) {
    const { name, value } = event.target;
    setProductForm((current) => ({ ...current, [name]: value }));
  }

  function handleUserChange(event) {
    const { name, value } = event.target;
    setUserForm((current) => ({ ...current, [name]: value }));
  }

  async function handleProductSubmit(event) {
    event.preventDefault();
    if (!permissions.inventory) {
      setToast("Tu rango no permite registrar inventario.");
      return;
    }

    const name = productForm.name.trim();
    const purchasePrice = Number(productForm.purchasePrice);
    const quantity = Number.parseInt(productForm.quantity, 10);
    const salePrice = Number(productForm.salePrice);

    if (!name || purchasePrice < 0 || salePrice < 0 || quantity < 1) {
      setToast("Revisa los datos del producto.");
      return;
    }

    setBusy(true);
    try {
      const existingProduct = products.find(
        (product) => product.name.toLowerCase() === name.toLowerCase()
      );

      if (existingProduct) {
        const productRef = doc(db, "products", existingProduct.id);
        await runTransaction(db, async (transaction) => {
          const productSnap = await transaction.get(productRef);
          const currentQuantity = Number(productSnap.data()?.quantity || 0);

          transaction.update(productRef, {
            purchasePrice,
            salePrice,
            quantity: currentQuantity + quantity,
            updatedAt: serverTimestamp(),
            updatedBy: auditUser(profile, authUser),
          });
        });

        await addAuditLog("inventory_updated", {
          productId: existingProduct.id,
          productName: name,
          quantityAdded: quantity,
        });
        setToast("Producto actualizado y cantidad sumada.");
      } else {
        const productRef = await addDoc(collection(db, "products"), {
          name,
          purchasePrice,
          salePrice,
          quantity,
          createdAt: serverTimestamp(),
          createdBy: auditUser(profile, authUser),
        });

        await addAuditLog("inventory_created", {
          productId: productRef.id,
          productName: name,
          quantityAdded: quantity,
        });
        setToast("Producto agregado al inventario.");
      }

      setProductForm(initialProductForm);
    } catch (error) {
      setToast(firebaseErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaleSubmit(event) {
    event.preventDefault();

    const quantity = Number.parseInt(saleQuantity, 10);
    if (!selectedProduct) {
      setToast("Selecciona un producto disponible.");
      return;
    }

    if (!quantity || quantity < 1 || quantity > Number(selectedProduct.quantity || 0)) {
      setToast("La cantidad a vender no es valida.");
      return;
    }

    setBusy(true);
    try {
      const productRef = doc(db, "products", selectedProduct.id);

      await runTransaction(db, async (transaction) => {
        const productSnap = await transaction.get(productRef);
        const productData = productSnap.data();
        const currentQuantity = Number(productData?.quantity || 0);

        if (currentQuantity < quantity) {
          throw new Error("No hay suficiente inventario.");
        }

        const total = Number(productData.salePrice || 0) * quantity;
        const profit =
          (Number(productData.salePrice || 0) - Number(productData.purchasePrice || 0)) *
          quantity;
        const saleRef = doc(collection(db, "sales"));

        transaction.update(productRef, {
          quantity: currentQuantity - quantity,
          updatedAt: serverTimestamp(),
          updatedBy: auditUser(profile, authUser),
        });

        transaction.set(saleRef, {
          productId: selectedProduct.id,
          productName: productData.name,
          quantity,
          unitSalePrice: Number(productData.salePrice || 0),
          unitPurchasePrice: Number(productData.purchasePrice || 0),
          total,
          profit,
          createdAt: serverTimestamp(),
          createdBy: auditUser(profile, authUser),
        });
      });

      await addAuditLog("sale_created", {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity,
      });

      setSaleProductId("");
      setSaleQuantity("");
      setToast("Venta registrada correctamente.");
    } catch (error) {
      setToast(error.message || firebaseErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleUserSubmit(event) {
    event.preventDefault();
    if (!permissions.users) {
      setToast("Solo el Dueño puede crear cuentas.");
      return;
    }

    const name = userForm.name.trim();
    const email = userForm.email.trim();
    const password = userForm.password;
    const role = userForm.role;

    if (!name || !email || password.length < 6 || !roles.includes(role)) {
      setToast("Completa el nombre, correo, contraseña y rango.");
      return;
    }

    setBusy(true);
    try {
      const secondaryApp = initializeApp(firebaseConfig, `create-user-${Date.now()}`);
      const secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);

      await setDoc(doc(db, "users", credential.user.uid), {
        name,
        email,
        role,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: auditUser(profile, authUser),
      });

      await signOut(secondaryAuth);
      await deleteApp(secondaryApp);
      await addAuditLog("user_created", { name, email, role });
      setUserForm(initialUserForm);
      setToast("Cuenta creada correctamente.");
    } catch (error) {
      setToast(firebaseErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addAuditLog(action, details) {
    if (!authUser || !profile) return;

    await addDoc(collection(db, "auditLogs"), {
      action,
      details,
      createdAt: serverTimestamp(),
      createdBy: auditUser(profile, authUser),
    });
  }

  if (!hasFirebaseConfig) {
    return <SetupMissing />;
  }

  if (authLoading) {
    return <CenteredPanel title="Cargando" text="Preparando el sistema..." />;
  }

  if (!authUser) {
    return (
      <LoginScreen
        busy={busy}
        form={loginForm}
        onChange={setLoginForm}
        onSubmit={handleLogin}
        toast={toast}
      />
    );
  }

  if (!profile) {
    return (
      <CenteredPanel
        title="Cuenta sin rango"
        text="Tu usuario existe en Firebase Auth, pero todavia no tiene perfil en Firestore. El Dueño debe crear o completar tu documento en users."
        action={
          <button className="primary" type="button" onClick={handleLogout}>
            Cerrar sesion
          </button>
        }
      />
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Sistema de inventario</p>
          <h1>Tienda</h1>
        </div>

        <nav className="navbar" aria-label="Navegacion principal">
          {permissions.inventory && (
            <NavButton activeView={activeView} view="inventory" onClick={setActiveView}>
              Agregar Producto
            </NavButton>
          )}
          {permissions.sales && (
            <NavButton activeView={activeView} view="sales" onClick={setActiveView}>
              Vender Productos
            </NavButton>
          )}
          {permissions.history && (
            <NavButton activeView={activeView} view="history" onClick={setActiveView}>
              Historial de Ventas
            </NavButton>
          )}
          {permissions.users && (
            <NavButton activeView={activeView} view="users" onClick={setActiveView}>
              Usuarios
            </NavButton>
          )}
        </nav>

        <div className="session-box">
          <strong>{profile.name}</strong>
          <span>{profile.role}</span>
          <button className="session-button" type="button" onClick={handleLogout}>
            Salir
          </button>
        </div>
      </header>

      <main className="shell">
        <section className="stats-grid" aria-label="Resumen del negocio">
          <Stat label="Productos" value={stats.products} />
          <Stat label="Unidades disponibles" value={stats.units} />
          <Stat label="Valor en inventario" value={money(stats.inventoryValue)} />
          <Stat label="Ventas registradas" value={money(stats.salesTotal)} />
        </section>

        {activeView === "inventory" && permissions.inventory && (
          <section>
            <SectionHeading eyebrow="Inventario" title="Agregar producto" />

            <div className="layout">
              <form className="panel form-grid" onSubmit={handleProductSubmit}>
                <label>
                  Nombre del producto
                  <input
                    name="name"
                    type="text"
                    placeholder="Ej. Arroz 1kg"
                    value={productForm.name}
                    onChange={handleProductChange}
                    required
                  />
                </label>

                <label>
                  Precio de compra por unidad
                  <input
                    name="purchasePrice"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00 Bs"
                    value={productForm.purchasePrice}
                    onChange={handleProductChange}
                    required
                  />
                </label>

                <label>
                  Cantidad
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    value={productForm.quantity}
                    onChange={handleProductChange}
                    required
                  />
                </label>

                <label>
                  Precio de venta por unidad
                  <input
                    name="salePrice"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00 Bs"
                    value={productForm.salePrice}
                    onChange={handleProductChange}
                    required
                  />
                </label>

                <button className="primary" type="submit" disabled={busy}>
                  Guardar producto
                </button>
              </form>

              <InventoryTable products={products} />
            </div>
          </section>
        )}

        {activeView === "sales" && permissions.sales && (
          <section>
            <SectionHeading eyebrow="Ventas" title="Vender productos" />

            <div className="layout compact">
              <form className="panel form-grid" onSubmit={handleSaleSubmit}>
                <label>
                  Producto
                  <select
                    value={saleProductId}
                    onChange={(event) => setSaleProductId(event.target.value)}
                    required
                  >
                    <option value="">
                      {availableProducts.length ? "Seleccionar producto" : "Sin productos disponibles"}
                    </option>
                    {availableProducts.map((product) => (
                      <option value={product.id} key={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Cantidad a vender
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="0"
                    value={saleQuantity}
                    onChange={(event) => setSaleQuantity(event.target.value)}
                    required
                  />
                </label>

                <div className="sale-preview">
                  {salePreview ? (
                    <>
                      Disponible: <strong>{salePreview.available}</strong> unidades
                      <br />
                      Total estimado: <strong>{money(salePreview.total)}</strong>
                      <br />
                      Ganancia estimada: <strong>{money(salePreview.profit)}</strong>
                    </>
                  ) : (
                    "Selecciona un producto para calcular la venta."
                  )}
                </div>

                <button className="primary" type="submit" disabled={busy}>
                  Registrar venta
                </button>
              </form>

              <StockList products={products} />
            </div>
          </section>
        )}

        {activeView === "history" && permissions.history && (
          <section>
            <SectionHeading eyebrow="Registro" title="Historial de ventas" />
            <SalesTable sales={sales} />
          </section>
        )}

        {activeView === "users" && permissions.users && (
          <section>
            <SectionHeading eyebrow="Administracion" title="Usuarios y rangos" />

            <div className="layout">
              <form className="panel form-grid" onSubmit={handleUserSubmit}>
                <label>
                  Nombre de la persona
                  <input
                    name="name"
                    type="text"
                    placeholder="Ej. Maria Perez"
                    value={userForm.name}
                    onChange={handleUserChange}
                    required
                  />
                </label>

                <label>
                  Correo de acceso
                  <input
                    name="email"
                    type="email"
                    placeholder="correo@tienda.com"
                    value={userForm.email}
                    onChange={handleUserChange}
                    required
                  />
                </label>

                <label>
                  Contraseña temporal
                  <input
                    name="password"
                    type="password"
                    minLength="6"
                    placeholder="Minimo 6 caracteres"
                    value={userForm.password}
                    onChange={handleUserChange}
                    required
                  />
                </label>

                <label>
                  Rango
                  <select name="role" value={userForm.role} onChange={handleUserChange}>
                    {roles.map((role) => (
                      <option value={role} key={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>

                <button className="primary" type="submit" disabled={busy}>
                  Crear cuenta
                </button>
              </form>

              <UsersTable users={users} />
            </div>
          </section>
        )}
      </main>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}

function LoginScreen({ busy, form, onChange, onSubmit, toast }) {
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="eyebrow">Acceso privado</p>
        <h1>Inventario Tienda</h1>

        <label>
          Correo
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange((current) => ({ ...current, email: event.target.value }))}
            required
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={form.password}
            onChange={(event) =>
              onChange((current) => ({ ...current, password: event.target.value }))
            }
            required
          />
        </label>

        <button className="primary" type="submit" disabled={busy}>
          Entrar
        </button>

        {toast && <p className="form-message">{toast}</p>}
      </form>
    </main>
  );
}

function SetupMissing() {
  return (
    <CenteredPanel
      title="Falta configurar Firebase"
      text="Crea un archivo .env con las variables de .env.example y reinicia el servidor de Vite."
    />
  );
}

function CenteredPanel({ title, text, action }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <p className="eyebrow">Sistema</p>
        <h1>{title}</h1>
        <p className="muted-copy">{text}</p>
        {action}
      </section>
    </main>
  );
}

function NavButton({ activeView, view, onClick, children }) {
  return (
    <button
      className={`nav-link ${activeView === view ? "active" : ""}`}
      type="button"
      onClick={() => onClick(view)}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SectionHeading({ eyebrow, title }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function InventoryTable({ products }) {
  return (
    <div className="panel">
      <div className="table-heading">
        <h3>Productos registrados</h3>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Compra</th>
              <th>Venta</th>
              <th>Cantidad</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td data-label="Producto">
                  <strong>{product.name}</strong>
                </td>
                <td data-label="Compra">{money(product.purchasePrice)}</td>
                <td data-label="Venta">{money(product.salePrice)}</td>
                <td data-label="Cantidad">{product.quantity}</td>
                <td data-label="Usuario">{product.updatedBy?.name || product.createdBy?.name || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!products.length && <p className="empty show">Todavia no hay productos agregados.</p>}
      </div>
    </div>
  );
}

function StockList({ products }) {
  return (
    <div className="panel">
      <h3>Disponibilidad</h3>
      <div className="product-list">
        {products.map((product) => (
          <article className="stock-item" key={product.id}>
            <span>
              <strong>{product.name}</strong>
              <br />
              Venta: {money(product.salePrice)} por unidad
            </span>
            <span className="pill">{product.quantity} und.</span>
          </article>
        ))}
      </div>
      {!products.length && <p className="empty show">Agrega productos para poder vender.</p>}
    </div>
  );
}

function SalesTable({ sales }) {
  return (
    <div className="panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Total</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td data-label="Fecha">{formatDate(sale.createdAt)}</td>
                <td data-label="Producto">
                  <strong>{sale.productName}</strong>
                </td>
                <td data-label="Cantidad">{sale.quantity}</td>
                <td data-label="Total">{money(sale.total)}</td>
                <td data-label="Usuario">{sale.createdBy?.name || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sales.length && <p className="empty show">No hay ventas registradas.</p>}
      </div>
    </div>
  );
}

function UsersTable({ users }) {
  return (
    <div className="panel">
      <div className="table-heading">
        <h3>Cuentas creadas</h3>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rango</th>
              <th>Creado por</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td data-label="Nombre">
                  <strong>{user.name}</strong>
                </td>
                <td data-label="Correo">{user.email}</td>
                <td data-label="Rango">{user.role}</td>
                <td data-label="Creado por">{user.createdBy?.name || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && <p className="empty show">No hay cuentas registradas.</p>}
      </div>
    </div>
  );
}

function auditUser(profile, authUser) {
  return {
    uid: authUser.uid,
    name: profile.name,
    email: profile.email,
    role: profile.role,
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = value.toDate ? value.toDate() : new Date(value);
  return date.toLocaleString("es-VE");
}

function money(value) {
  return `${moneyFormatter.format(Number(value || 0))} Bs`;
}

function firebaseErrorMessage(error) {
  if (error?.code === "auth/email-already-in-use") return "Ese correo ya esta registrado.";
  if (error?.code === "auth/weak-password") return "La contraseña debe tener al menos 6 caracteres.";
  if (error?.code === "permission-denied") return "No tienes permisos para realizar esta accion.";
  return error?.message || "Ocurrio un error inesperado.";
}

export default App;
